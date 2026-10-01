import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, copyFile, readdir, unlink, readFile, realpath } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import dgram from 'node:dgram';
import path from 'node:path';
import { AppError, assertServerExecutable, validateSettings, renderConfig, renderBattleye, serverArgs, clientArgs, displayCommand } from './config.mjs';
import { atomicWrite } from './store.mjs';
import { isFile, isDirectory } from './discovery.mjs';
import { RptTail } from './logs.mjs';
import { hostingInfo, bindAddress } from './network.mjs';
import { gameLaunch, armaProcesses, ownsServer } from './game-launch.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkUdpPorts(s) {
  const sockets = [];
  try {
    for (let n = 0; n < 5; n++) {
      const socket = dgram.createSocket('udp4'); sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.once('error', () => reject(new AppError(`UDP ${s.port + n} is unavailable. Stop the other server or choose another game port.`, 409)));
        socket.bind(s.port + n, bindAddress(s), resolve);
      });
    }
  } finally { for (const socket of sockets) { try { socket.close(); } catch { /* Already closed/unbound. */ } } }
}
export class ProcessManager {
  constructor({ dir, logs, demo = false, deps = {} }) {
    // Injectable for tests; defaults are the real launchers.
    this.deps = { spawn, gameLaunch, armaProcesses, ownsServer, platform: process.platform, startupGraceMs: demo ? 0 : 2500, ...deps };
    this.dir = dir; this.logs = logs; this.demo = demo; this.child = null;
    this.state = 'stopped'; this.busy = null; this.startedAt = null;
    this.activeSettings = null; this.lastExit = null; this.lastError = null; this.lastJoin = 0;
    this.configFile = path.join(dir, 'runtime', 'server.cfg');
    this.profilesDir = path.join(dir, 'profiles'); this.tailTimer = null;
    this.battleyeDir = path.join(dir, 'runtime', 'BattlEye');
    this.sessionFile = path.join(dir, 'runtime', 'server-session.json');
  }
  startLogTail() {
    const rpt = new RptTail(this.profilesDir, this.logs, this.startedAt - 1000);
    const consoleTail = new RptTail(path.dirname(this.configFile), this.logs, this.startedAt - 1000, /^server-console\.log$/i, 'server');
    this.logTails = [rpt, consoleTail];
    void rpt.poll(); void consoleTail.poll();
    this.logTimer = setInterval(() => { void rpt.poll(); void consoleTail.poll(); }, 1200); this.logTimer.unref();
  }
  async restore() {
    if (this.demo) return;
    let record;
    try { record = JSON.parse(await readFile(this.sessionFile, 'utf8')); } catch { return; }
    let s;
    try { s = validateSettings(record.settings); if (!await this.deps.ownsServer(record.pid, s.serverExe, this.configFile)) return; }
    catch { this.logs.add('Saved server session could not be verified. No process was adopted or stopped.'); return; }
    const child = new EventEmitter(); child.pid = record.pid;
    child.kill = () => { void this.deps.ownsServer(child.pid, s.serverExe, this.configFile).then(owned => { if (owned) process.kill(child.pid); }).catch(error => this.logs.add(`Recovered server stop failed: ${error.message}`)); };
    this.child = child; this.activeSettings = s; this.startedAt = record.startedAt; this.state = 'running';
    const poll = setInterval(() => { void this.deps.ownsServer(child.pid, s.serverExe, this.configFile).then(owned => { if (!owned && this.child === child) { clearInterval(poll); clearInterval(this.logTimer); this.logTimer = null; this.logDrain = this.drainLogs(); this.child = null; this.state = 'stopped'; this.startedAt = null; child.emit('close', null, null); } }).catch(() => {}); }, 2000); poll.unref();
    this.tailTimer = poll;
    this.startLogTail();
    this.logs.setSecrets([s.password, s.adminPassword, s.rconPassword]);
    this.logs.add(`Reconnected to managed server PID ${child.pid} after desktop restart.`);
  }
  drainLogs() { return Promise.all((this.logTails || []).map(async tail => { await tail.poll(); await tail.poll(); })); }
  status() {
    const s = this.child ? this.activeSettings : null;
    return {
      state: this.state, busy: this.busy, demo: this.demo, pid: this.child?.pid || null,
      startedAt: this.startedAt, uptimeSeconds: this.child && this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      lastExit: this.lastExit, lastError: this.lastError,
      serverExe: s?.serverExe || this.lastServerExe || null, command: this.child ? this.activeCommand : null,
      active: s ? { serverExe: s.serverExe, serverName: s.serverName, port: s.port, mission: s.mission, lan: s.lan, starlink: s.starlink, vpnIp: s.vpnIp, starlinkVpn: s.starlinkVpn, publicIp: s.publicIp,
        maxPlayers: s.maxPlayers, mods: s.mods.filter(m => m.enabled).length,
        modList: s.mods.filter(m => m.enabled).map(m => ({ path: m.path, scope: m.scope })), battleye: s.battleye, rconEnabled: s.rconEnabled } : null,
      readiness: this.demo ? 'Demo only — no game server.' : 'Process state only; game readiness is not queried. Check the RPT log and in-game server browser.'
    };
  }
  async perform(action, fn) {
    if (this.busy) throw new AppError(`Server is busy ${this.busy}. Try again after it finishes.`, 409);
    this.busy = action;
    try { return await fn(); }
    finally { this.busy = null; }
  }
  async start(settings) { return this.perform('starting', () => this.startInternal(settings)); }
  async startInternal(settings) {
    if (this.child) throw new AppError('The managed server is already running.', 409);
    const s = validateSettings(settings);
    if (!this.demo && this.deps.platform !== 'win32') throw new AppError('Live game/server launching requires Windows. Use --demo on this operating system.');
    this.logs.setSecrets([s.password, s.adminPassword, s.rconPassword]);
    if (!this.demo) {
      assertServerExecutable(s.serverExe, s.gameExe);
      const processes = await this.deps.armaProcesses();
      if (processes.servers.length) throw new AppError(`An Arma dedicated server is already running (PID ${processes.servers.map(p => p.pid).join(', ')}). Stop it before starting another server here.`, 409);
      if (s.starlink && s.starlinkVpn && !hostingInfo(s).assigned) throw new AppError('The saved VPN address is not assigned to this PC. Connect your VPN and detect its address again before hosting.');
      if (!(await isFile(s.serverExe))) throw new AppError(`Dedicated server executable not found: ${s.serverExe}. Choose arma3server_x64.exe under Dedicated Server Installation in Setup and save.`);
      if (s.gameExe && await isFile(s.gameExe) && await realpath(s.gameExe).catch(() => 1) === await realpath(s.serverExe).catch(() => 2)) throw new AppError('The server and game executables resolve to the same file. Choose different files in Setup.');
      for (const m of s.mods.filter(m => m.enabled && m.scope !== 'client')) {
        if (!(await isDirectory(m.path))) throw new AppError(`Enabled mod folder not found: ${m.path}`);
      }
      await checkUdpPorts(s);
    }
    await mkdir(path.dirname(this.configFile), { recursive: true, mode: 0o700 });
    await mkdir(this.profilesDir, { recursive: true, mode: 0o700 });
    if (s.rconEnabled) {
      await mkdir(this.battleyeDir, { recursive: true, mode: 0o700 });
      if (!this.demo) {
        const dll = /_x64\.exe$/i.test(s.serverExe) ? 'BEServer_x64.dll' : 'BEServer.dll';
        const source = path.join(path.dirname(s.serverExe), 'BattlEye', dll);
        if (!(await isFile(source))) throw new AppError(`BattlEye server library missing: ${source}. Verify the dedicated server installation in Steam before enabling live monitoring.`);
        await copyFile(source, path.join(this.battleyeDir, dll));
        const socket = dgram.createSocket('udp4');
        try { await new Promise((resolve, reject) => { socket.once('error', () => reject(new AppError('RCon UDP port is unavailable. Choose another RCon port in Setup.', 409))); socket.bind(s.rconPort, '127.0.0.1', resolve); }); }
        finally { try { socket.close(); } catch {} }
      }
      // Only remove renamed active configs in our own managed runtime folder.
      for (const name of await readdir(this.battleyeDir)) if (/^BEServer(?:_x64)?_active_[a-z0-9]+\.cfg$/i.test(name)) await unlink(path.join(this.battleyeDir, name));
      await atomicWrite(path.join(this.battleyeDir, 'BEServer_x64.cfg'), renderBattleye(s));
      await atomicWrite(path.join(this.battleyeDir, 'BEServer.cfg'), renderBattleye(s));
    }
    await atomicWrite(this.configFile, renderConfig(s));
    this.state = 'starting'; this.lastError = null; this.lastExit = null;
    const argv = serverArgs(s, this);
    if (argv.join(' ').length > 28000) { this.state = 'stopped'; throw new AppError('Launch arguments are too long. Reduce mod count or shorten folder paths.'); }
    if (this.demo) this.logs.add('DEMO launch requested — no game files will be executed.');
    else {
      assertServerExecutable(s.serverExe, s.gameExe); // the exact string handed to spawn below
      this.logs.add('Starting dedicated server');
      this.logs.add(`Executable: ${s.serverExe}`);
      this.logs.add(`Command: ${displayCommand(s.serverExe, argv)}`);
    }
    if (!this.demo && s.mods.some(m => m.enabled)) this.logs.add('Mods must be installed with dependencies and trusted signing keys; the manager does not download them.');
    const output = this.demo ? null : openSync(path.join(this.dir, 'runtime', 'server-console.log'), 'w');
    const child = this.demo
      ? spawn(process.execPath, [fileURLToPath(new URL('./demo-worker.mjs', import.meta.url))], { cwd: this.dir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], shell: false })
      : this.deps.spawn(s.serverExe, argv, { cwd: path.dirname(s.serverExe), shell: false, detached: true, windowsHide: true, stdio: ['ignore', output, output] });
    if (output !== null) closeSync(output);
    this.child = child; this.activeSettings = structuredClone(s); this.startedAt = Date.now();
    this.activeCommand = this.demo ? 'DEMO worker (no Arma process)' : displayCommand(s.serverExe, argv); this.lastServerExe = s.serverExe;
    if (!this.demo) this.startLogTail();
    const streamLine = stream => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        const lines = (pending + chunk).split(/\r?\n/); pending = lines.pop().slice(-8192);
        for (const line of lines) this.logs.add(line, 'server');
      });
      stream.on('end', () => { if (pending) this.logs.add(pending, 'server'); });
    };
    if (this.demo) { streamLine(child.stdout); streamLine(child.stderr); }
    child.on('error', error => { this.lastError = error.message; this.logs.add(`Process error: ${error.message}`); });
    child.once('close', (code, signal) => {
      if (this.child !== child) return;
      clearInterval(this.tailTimer); this.tailTimer = null;
      clearInterval(this.logTimer); this.logTimer = null;
      this.logDrain = this.drainLogs();
      const unexpected = this.state === 'starting' || (this.state === 'running' && code !== 0 && code !== null);
      this.child = null; this.state = unexpected ? 'failed' : 'stopped';
      this.lastExit = { code, signal, time: new Date().toISOString() };
      if (unexpected) this.lastError = `Dedicated server exited unexpectedly (exit code ${code ?? 'none'}, signal ${signal ?? 'none'}).`;
      this.logs.add(`Managed process exited (code=${code ?? 'none'}, signal=${signal ?? 'none'}).`);
      this.startedAt = null;
      void unlink(this.sessionFile).catch(() => {});
    });
    const fail = (message, status = 502) => {
      clearInterval(this.logTimer); this.logTimer = null;
      this.state = 'failed'; this.lastError = message; this.logs.add(message);
      void unlink(this.sessionFile).catch(() => {});
      return new AppError(message, status);
    };
    try { await once(child, 'spawn'); }
    catch (error) {
      this.child = null; this.startedAt = null;
      throw fail(`Could not launch the dedicated server (${s.serverExe}): ${error.message}`, 500);
    }
    if (!this.demo) {
      child.unref();
      this.logs.add(`PID: ${child.pid}`);
      await atomicWrite(this.sessionFile, JSON.stringify({ pid: child.pid, settings: s, startedAt: this.startedAt }));
    }
    // Windows accepting CreateProcess is not a healthy server: watch for an immediate exit first.
    if (this.deps.startupGraceMs > 0) await Promise.race([once(child, 'close').catch(() => {}), sleep(this.deps.startupGraceMs)]);
    if (this.child !== child) {
      const code = this.lastExit?.code;
      const hint = this.demo ? '' : await this.consoleTail();
      throw fail(`Dedicated server exited during startup (exit code ${code ?? 'none'}). Run diagnostics and check the server log.${hint}`);
    }
    if (!this.demo && this.deps.platform === 'win32') {
      let owned = false;
      try { owned = await this.deps.ownsServer(child.pid, s.serverExe, this.configFile); if (!owned) { await sleep(400); owned = await this.deps.ownsServer(child.pid, s.serverExe, this.configFile); } }
      catch (error) { this.logs.add(`Process identity check unavailable: ${error.message}`); owned = true; }
      if (!owned && this.child === child) {
        try { child.kill(); } catch { /* Already gone. */ }
        this.child = null; this.startedAt = null;
        throw fail(`PID ${child.pid} could not be confirmed as ${path.win32.basename(s.serverExe)} running with ArmaHost's configuration. The process was stopped. Check security software and the configured server path.`);
      }
    }
    this.state = 'running';
    this.logs.add(`Dedicated server process running (PID ${child.pid}). This is not confirmation that the mission is ready to join.`);
    return this.status();
  }
  async consoleTail() {
    try {
      const text = (await readFile(path.join(this.dir, 'runtime', 'server-console.log'), 'utf8')).trim().split(/\r?\n/).slice(-3).join(' | ');
      return text ? ` Last output: ${text.slice(-400)}` : '';
    } catch { return ''; }
  }
  async stop() { return this.perform('stopping', () => this.stopInternal()); }
  async stopInternal() {
    const child = this.child;
    if (!child) return this.status();
    this.state = 'stopping';
    this.logs.add('Stopping the owned server process. This is process termination, not an in-game save or graceful RCON shutdown.');
    await new Promise((resolve, reject) => {
      let forceTimer; let timeout;
      const cleanup = () => { clearTimeout(forceTimer); clearTimeout(timeout); child.off('close', done); };
      const done = () => { cleanup(); resolve(); };
      child.once('close', done);
      try { child.kill('SIGTERM'); } catch (error) { cleanup(); this.state = 'running'; reject(error); return; }
      forceTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* The exit listener handles an already-finished process. */ } }, 3000);
      timeout = setTimeout(() => { cleanup(); this.state = 'running'; reject(new AppError('Server did not exit. Check its PID in Task Manager; no other processes were targeted.', 500)); }, 6500);
    });
    await this.logDrain;
    return this.status();
  }
  async restart(settings) {
    return this.perform('restarting', async () => { await this.stopInternal(); return this.startInternal(settings); });
  }
  async join(savedSettings) {
    return this.perform('launching the game', async () => {
      if (!this.child) throw new AppError('Start the managed server first.', 409);
      const s = { ...structuredClone(this.activeSettings), gameExe: savedSettings.gameExe };
      return this.launchGame(s);
    });
  }
  async joinRemote(settings) {
    return this.perform('launching the game', async () => {
      const s = validateSettings(settings);
      if (!s.remoteHost) throw new AppError('Enter your friend’s server address first.');
      this.logs.setSecrets([s.remotePassword]);
      return this.launchGame(s, { host: s.remoteHost, port: s.remotePort, password: s.remotePassword });
    });
  }
  async launchGame(s, connection) {
      if (Date.now() - this.lastJoin < 10000) throw new AppError('A game launch was just requested. Allow it to open before trying again.', 429);
      if (this.demo) { this.logs.add('DEMO Join clicked. A real session would launch Arma 3; nothing was executed.'); this.lastJoin = Date.now(); return { message: 'Demo only: no game was launched.' }; }
      if (!(await isFile(s.gameExe))) throw new AppError('Game executable not found. Configure arma3_x64.exe in Setup and save.');
      const processes = await this.deps.armaProcesses();
      if (processes.games.length) throw new AppError('Arma 3 is already running. Use Multiplayer > Direct Connect in the existing game, or close it before pressing Join.', 409);
      for (const m of s.mods.filter(m => m.enabled && m.scope !== 'server')) if (!(await isDirectory(m.path))) throw new AppError(`Game mod folder not found: ${m.path}`);
      const { exe, args } = this.deps.gameLaunch(s, connection);
      if (!(await isFile(exe))) throw new AppError('Arma3BattlEye.exe is missing from the game folder. Verify Arma 3 in Steam before joining a BattlEye session.');
      if (args.join(' ').length > 28000) throw new AppError('Game arguments exceed the safe Windows command-line length. Reduce mod paths.');
      const child = this.deps.spawn(exe, args, { cwd: path.dirname(s.gameExe), shell: false, detached: true, stdio: 'ignore' });
      child.on('error', error => this.logs.add(`Game launch error: ${error.message}`));
      try { await once(child, 'spawn'); } catch (error) { throw new AppError(`Could not launch Arma 3: ${error.message}`); }
      child.unref(); this.lastJoin = Date.now();
      this.logs.add(`Game launch dispatched: ${displayCommand(exe, args)}.`);
      if (s.battleye) this.logs.add('Game launched through the official BattlEye bootstrap. Allow its update check to finish.');
      return { message: 'Game launch dispatched. Joining is not confirmed; check Arma 3.' };
  }
  async close({ leaveRunning = false } = {}) {
    while (this.busy) await sleep(50);
    if (this.child && (!leaveRunning || this.demo)) await this.stop();
    clearInterval(this.tailTimer);
    clearInterval(this.logTimer);
  }
}
