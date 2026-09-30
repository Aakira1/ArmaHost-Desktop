import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dgram from 'node:dgram';
import path from 'node:path';
import { AppError, validateSettings, renderConfig, serverArgs, clientArgs, displayCommand } from './config.mjs';
import { atomicWrite } from './store.mjs';
import { isFile, isDirectory } from './discovery.mjs';
import { RptTail } from './logs.mjs';
import { hostingInfo } from './network.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkUdpPorts(s) {
  const sockets = [];
  try {
    for (let n = 0; n < 5; n++) {
      const socket = dgram.createSocket('udp4'); sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.once('error', () => reject(new AppError(`UDP ${s.port + n} is unavailable. Stop the other server or choose another game port.`, 409)));
        socket.bind(s.port + n, s.starlink ? s.vpnIp : s.lan ? '0.0.0.0' : '127.0.0.1', resolve);
      });
    }
  } finally { for (const socket of sockets) { try { socket.close(); } catch { /* Already closed/unbound. */ } } }
}
export class ProcessManager {
  constructor({ dir, logs, demo = false }) {
    this.dir = dir; this.logs = logs; this.demo = demo; this.child = null;
    this.state = 'stopped'; this.busy = null; this.startedAt = null;
    this.activeSettings = null; this.lastExit = null; this.lastError = null; this.lastJoin = 0;
    this.configFile = path.join(dir, 'runtime', 'server.cfg');
    this.profilesDir = path.join(dir, 'profiles'); this.tailTimer = null;
  }
  status() {
    const s = this.child ? this.activeSettings : null;
    return {
      state: this.state, busy: this.busy, demo: this.demo, pid: this.child?.pid || null,
      startedAt: this.startedAt, uptimeSeconds: this.child && this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      lastExit: this.lastExit, lastError: this.lastError,
      active: s ? { serverName: s.serverName, port: s.port, mission: s.mission, lan: s.lan, starlink: s.starlink, vpnIp: s.vpnIp,
        maxPlayers: s.maxPlayers, mods: s.mods.filter(m => m.enabled).length } : null,
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
    if (!this.demo && process.platform !== 'win32') throw new AppError('Live game/server launching requires Windows. Use --demo on this operating system.');
    this.logs.setSecrets([s.password, s.adminPassword]);
    if (!this.demo) {
      if (s.starlink && !hostingInfo(s).assigned) throw new AppError('The saved VPN address is not assigned to this PC. Connect your VPN and detect its address again before hosting.');
      if (!(await isFile(s.serverExe))) throw new AppError('Server executable not found. Configure arma3server_x64.exe in Setup and save.');
      for (const m of s.mods.filter(m => m.enabled && m.scope !== 'client')) {
        if (!(await isDirectory(m.path))) throw new AppError(`Enabled mod folder not found: ${m.path}`);
      }
      await checkUdpPorts(s);
    }
    await mkdir(path.dirname(this.configFile), { recursive: true, mode: 0o700 });
    await mkdir(this.profilesDir, { recursive: true, mode: 0o700 });
    await atomicWrite(this.configFile, renderConfig(s));
    this.state = 'starting'; this.lastError = null; this.lastExit = null;
    const argv = serverArgs(s, this);
    if (argv.join(' ').length > 28000) { this.state = 'stopped'; throw new AppError('Launch arguments are too long. Reduce mod count or shorten folder paths.'); }
    this.logs.add(this.demo ? 'DEMO launch requested — no game files will be executed.' : `Launching: ${displayCommand(s.serverExe, argv)}`);
    if (!this.demo && s.mods.some(m => m.enabled)) this.logs.add('Mods must be installed with dependencies and trusted signing keys; the manager does not download them.');
    const child = this.demo
      ? spawn(process.execPath, [fileURLToPath(new URL('./demo-worker.mjs', import.meta.url))], { cwd: this.dir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], shell: false })
      : spawn(s.serverExe, argv, { cwd: path.dirname(s.serverExe), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child; this.activeSettings = structuredClone(s); this.startedAt = Date.now();
    const streamLine = stream => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        const lines = (pending + chunk).split(/\r?\n/); pending = lines.pop().slice(-8192);
        for (const line of lines) this.logs.add(line, 'server');
      });
      stream.on('end', () => { if (pending) this.logs.add(pending, 'server'); });
    };
    streamLine(child.stdout); streamLine(child.stderr);
    child.on('error', error => { this.lastError = error.message; this.logs.add(`Process error: ${error.message}`); });
    child.once('close', (code, signal) => {
      if (this.child !== child) return;
      clearInterval(this.tailTimer); this.tailTimer = null;
      this.child = null; this.state = 'stopped';
      this.lastExit = { code, signal, time: new Date().toISOString() };
      this.logs.add(`Managed process exited (code=${code ?? 'none'}, signal=${signal ?? 'none'}).`);
      this.startedAt = null;
    });
    try { await once(child, 'spawn'); }
    catch (error) {
      this.state = 'stopped'; this.child = null; this.startedAt = null;
      throw new AppError(`Could not launch the server: ${error.message}`);
    }
    this.state = 'running';
    if (!this.demo) {
      const tail = new RptTail(this.profilesDir, this.logs, this.startedAt - 1000);
      this.tailTimer = setInterval(() => { void tail.poll(); }, 1200); this.tailTimer.unref();
    }
    this.logs.add(`Managed process started (PID ${child.pid}). This is not confirmation that the game is ready to join.`);
    return this.status();
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
    return this.status();
  }
  async restart(settings) {
    return this.perform('restarting', async () => { await this.stopInternal(); return this.startInternal(settings); });
  }
  async join(savedSettings) {
    return this.perform('launching the game', async () => {
      if (!this.child) throw new AppError('Start the managed server first.', 409);
      const s = { ...structuredClone(this.activeSettings), gameExe: savedSettings.gameExe };
      if (Date.now() - this.lastJoin < 10000) throw new AppError('A game launch was just requested. Allow it to open before trying again.', 429);
      if (this.demo) { this.logs.add('DEMO Join clicked. A real session would launch Arma 3; nothing was executed.'); this.lastJoin = Date.now(); return { message: 'Demo only: no game was launched.' }; }
      if (!(await isFile(s.gameExe))) throw new AppError('Game executable not found. Configure arma3_x64.exe in Setup and save.');
      for (const m of s.mods.filter(m => m.enabled && m.scope !== 'server')) if (!(await isDirectory(m.path))) throw new AppError(`Game mod folder not found: ${m.path}`);
      const args = clientArgs(s);
      if (args.join(' ').length > 28000) throw new AppError('Game arguments exceed the safe Windows command-line length. Reduce mod paths.');
      const child = spawn(s.gameExe, args, { cwd: path.dirname(s.gameExe), shell: false, detached: true, stdio: 'ignore' });
      child.on('error', error => this.logs.add(`Game launch error: ${error.message}`));
      try { await once(child, 'spawn'); } catch (error) { throw new AppError(`Could not launch Arma 3: ${error.message}`); }
      child.unref(); this.lastJoin = Date.now();
      this.logs.add(`Game launch dispatched: ${displayCommand(s.gameExe, args)}. Close an already-running game before using Join.`);
      if (s.battleye) this.logs.add('BattlEye is enabled on the server. If the game asks to restart, launch through the official Arma launcher with BattlEye enabled and use Direct Connect.');
      return { message: 'Game launch dispatched. Joining is not confirmed; check Arma 3.' };
    });
  }
  async close() {
    while (this.busy) await sleep(50);
    if (this.child) await this.stop();
    clearInterval(this.tailTimer);
  }
}
