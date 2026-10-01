import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults, validateSettings, serverArgs, clientArgs, assertServerExecutable, renderConfig } from '../src/config.mjs';
import { ProcessManager } from '../src/process-manager.mjs';
import { findLauncher, endGameProcesses } from '../src/game-launch.mjs';
import { LogBook } from '../src/logs.mjs';

let portBase = 23100 + (process.pid % 200) * 10;
async function fixture(fn, { deps = {}, settings = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-launch-'));
  const serverDir = path.join(dir, 'Arma 3 Server'); const gameDir = path.join(dir, 'Arma 3');
  await mkdir(serverDir); await mkdir(gameDir);
  const serverExe = path.join(serverDir, 'arma3server_x64.exe'); const gameExe = path.join(gameDir, 'arma3_x64.exe');
  for (const f of [serverExe, gameExe, path.join(gameDir, 'arma3battleye.exe')]) await writeFile(f, '');
  const spawns = []; const gameCalls = []; const children = []; const opened = []; const killed = [];
  const fake = { exit: null, spawnError: null };
  const spawn = (exe, args, options) => {
    const child = new EventEmitter(); child.pid = 4000 + spawns.length; child.unref = () => {}; child.killed = false;
    child.kill = () => { queueMicrotask(() => child.emit('close', 1, null)); };
    spawns.push({ exe, args, options }); children.push(child);
    setImmediate(() => {
      if (fake.spawnError) return child.emit('error', new Error(fake.spawnError));
      child.emit('spawn');
      if (fake.exit !== null) setTimeout(() => child.emit('close', fake.exit, null), 5);
    });
    return child;
  };
  const logs = new LogBook(dir);
  const manager = new ProcessManager({ dir, logs, deps: {
    spawn, platform: 'win32', startupGraceMs: 60, openUrl: url => opened.push(url), closeWaitMs: 300, launchVerifyMs: 0,
    findLauncher: exe => findLauncher(exe, async () => ({ games: [] })),
    endGameProcesses: (pids, options) => endGameProcesses(pids, { ...options, kill: async pid => { killed.push(pid); } }),
    armaProcesses: async () => ({ games: [], servers: [] }), ownsServer: async () => true,
    gameLaunch: (s, c) => { gameCalls.push(s); return { exe: path.join(gameDir, 'arma3battleye.exe'), args: ['2', '1', '0'] }; }, ...deps } });
  const s = validateSettings({ ...defaults(), serverExe, gameExe, port: (portBase += 10), joinMethod: 'direct', ...settings });
  try { await fn({ manager, s, spawns, gameCalls, children, fake, dir, serverExe, gameExe, gameDir, logs, opened, killed }); }
  finally { await manager.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); }
}

test('Start Dedicated Server spawns only the server executable and never the game', () => fixture(async ({ manager, s, spawns, gameCalls, serverExe, gameExe }) => {
  const status = await manager.start(s);
  assert.equal(spawns.length, 1); assert.equal(spawns[0].exe, serverExe);
  assert.ok(!spawns.some(c => c.exe === gameExe || /arma3(_x64|battleye)\.exe$/i.test(c.exe)));
  assert.equal(spawns[0].options.shell, false); assert.equal(spawns[0].options.detached, true);
  assert.ok(spawns[0].args.some(a => a.startsWith('-config=')) && spawns[0].args.includes(`-port=${s.port}`));
  assert.equal(gameCalls.length, 0);
  assert.equal(status.state, 'running'); assert.equal(status.serverExe, serverExe);
  assert.ok(manager.logs.since(0).entries.some(e => /Starting dedicated server/.test(e.message)));
  assert.ok(manager.logs.since(0).entries.some(e => /Executable: .*arma3server_x64\.exe/.test(e.message)));
  assert.ok(manager.logs.since(0).entries.some(e => /PID: 4000/.test(e.message)));
}));

test('Start works without any game executable configured', () => fixture(async ({ manager, s, spawns }) => {
  await manager.start({ ...s, gameExe: '' });
  assert.equal(spawns.length, 1);
}));

test('Join launches the game path and cannot replace the server process', () => fixture(async ({ manager, s, spawns, gameCalls, children, serverExe }) => {
  await manager.start(s);
  const child = manager.child; const active = manager.activeSettings; const pid = manager.status().pid;
  const result = await manager.join(s);
  assert.match(result.message, /Game launch/);
  assert.equal(gameCalls.length, 1); assert.equal(spawns.length, 2);
  assert.match(spawns[1].exe, /arma3battleye\.exe$/); assert.equal(spawns[0].exe, serverExe);
  assert.equal(manager.child, child); assert.equal(manager.activeSettings, active); assert.equal(manager.status().pid, pid);
  assert.equal(manager.status().state, 'running'); assert.equal(children.length, 2);
}));

test('Join refuses when the game is already running and without a server', () => fixture(async ({ manager, s, spawns }) => {
  await assert.rejects(manager.join(s), /Start the managed server first/);
  await manager.start(s);
  manager.deps.armaProcesses = async () => ({ games: [{ name: 'arma3_x64.exe', pid: 9 }], servers: [] });
  await assert.rejects(manager.join(s), /already running/);
  assert.equal(spawns.length, 1);
}));

test('wrong executables are rejected for the server path', () => {
  for (const name of ['arma3_x64.exe', 'arma3.exe', 'arma3battleye.exe', 'arma3launcher.exe', 'steam.exe', 'arma3server_x64.exe.bat']) {
    assert.throws(() => assertServerExecutable(`C:\\Arma 3\\${name}`), /Refusing|dedicated server/i, name);
    assert.throws(() => validateSettings({ ...defaults(), serverExe: `C:\\Arma 3\\${name}` }), /Server executable must point to/, name);
  }
  assert.doesNotThrow(() => assertServerExecutable('C:\\Server\\arma3server_x64.exe'));
  assert.doesNotThrow(() => assertServerExecutable('C:\\Server\\ARMA3SERVER.EXE'));
  assert.throws(() => assertServerExecutable(''), /No dedicated server executable/);
});

test('server and game executables may not collide', () => {
  assert.throws(() => assertServerExecutable('C:\\A\\arma3server.exe', 'c:/a/ARMA3SERVER.exe'), /same file/);
  assert.throws(() => validateSettings({ ...defaults(), gameExe: 'C:\\A\\arma3_x64.exe', serverExe: 'C:\\A\\arma3_x64.exe' }), /must point to/);
});

test('missing or unset server executable fails clearly and never falls back to the game', () => fixture(async ({ manager, s, spawns, gameCalls, dir }) => {
  await assert.rejects(manager.start({ ...s, serverExe: path.join(dir, 'nope', 'arma3server_x64.exe') }), /Dedicated server executable not found.*nope/);
  await assert.rejects(manager.start({ ...s, serverExe: '' }), /No dedicated server executable/);
  assert.equal(spawns.length, 0); assert.equal(gameCalls.length, 0); assert.equal(manager.status().state, 'stopped');
}));

test('immediate server exit is reported as FAILED with the exit code', () => fixture(async ({ manager, s, fake }) => {
  fake.exit = 3;
  await assert.rejects(manager.start(s), /exited during startup.*3/i);
  const status = manager.status();
  assert.equal(status.state, 'failed'); assert.equal(status.pid, null); assert.equal(status.lastExit.code, 3); assert.match(status.lastError, /3/);
}));

test('a spawn error is reported as FAILED', () => fixture(async ({ manager, s, fake }) => {
  fake.spawnError = 'EACCES';
  await assert.rejects(manager.start(s), /EACCES/);
  assert.equal(manager.status().state, 'failed'); assert.match(manager.status().lastError, /EACCES/);
}));

test('a process that is not the configured server executable is not reported healthy', () => fixture(async ({ manager, s }) => {
  manager.deps.ownsServer = async () => false;
  await assert.rejects(manager.start(s), /could not be confirmed/i);
  assert.equal(manager.status().state, 'failed');
}, { deps: {} }));

test('server already running blocks a second start without spawning', () => fixture(async ({ manager, s, spawns }) => {
  await manager.start(s);
  await assert.rejects(manager.start(s), /already running/);
  assert.equal(spawns.length, 1);
}));

test('another dedicated server on the machine blocks start', () => fixture(async ({ manager, s, spawns }) => {
  manager.deps.armaProcesses = async () => ({ games: [], servers: [{ name: 'arma3server_x64.exe', pid: 77 }] });
  await assert.rejects(manager.start(s), /already running.*77/);
  assert.equal(spawns.length, 0);
}));

test('restart stops the old server then spawns the server executable again', () => fixture(async ({ manager, s, spawns, serverExe }) => {
  await manager.start(s); const first = manager.status().pid;
  await manager.restart(s);
  assert.equal(spawns.length, 2); assert.ok(spawns.every(c => c.exe === serverExe));
  assert.notEqual(manager.status().pid, first); assert.equal(manager.status().state, 'running');
}));

test('session recovery adopts a verified server and leaves it running on close', () => fixture(async ({ manager, s, dir }) => {
  await manager.start(s);
  const recovered = new ProcessManager({ dir, logs: new LogBook(dir), deps: manager.deps });
  await recovered.restore();
  assert.equal(recovered.status().state, 'running'); assert.equal(recovered.status().pid, manager.status().pid);
  await recovered.close({ leaveRunning: true });
  assert.equal(recovered.status().pid, manager.status().pid);
}));

test('failed starts do not leave a recoverable session behind', () => fixture(async ({ manager, s, fake, dir }) => {
  fake.exit = 1;
  await assert.rejects(manager.start(s));
  const recovered = new ProcessManager({ dir, logs: new LogBook(dir), deps: manager.deps });
  await recovered.restore();
  assert.equal(recovered.status().state, 'stopped');
}));

test('server arguments: vanilla, shared, server-only and client-only mods', () => {
  const ctx = { configFile: 'C:/d/server.cfg', profilesDir: 'C:/d/profiles' };
  const mods = [{ path: 'C:/m/shared', enabled: true, scope: 'shared' }, { path: 'C:/m/server', enabled: true, scope: 'server' },
    { path: 'C:/m/client', enabled: true, scope: 'client' }, { path: 'C:/m/off', enabled: false, scope: 'shared' }];
  const vanilla = serverArgs(validateSettings(defaults()), ctx);
  assert.ok(!vanilla.some(a => /^-(mod|serverMod)=/i.test(a)));
  const modded = serverArgs(validateSettings({ ...defaults(), mods }), ctx);
  assert.ok(modded.includes('-mod=C:/m/shared')); assert.ok(modded.includes('-serverMod=C:/m/server'));
  assert.ok(!modded.join(' ').includes('C:/m/client') && !modded.join(' ').includes('C:/m/off'));
  const only = serverArgs(validateSettings({ ...defaults(), mods: [mods[1]] }), ctx);
  assert.deepEqual(only.filter(a => /^-(mod|serverMod)=/i.test(a)), ['-serverMod=C:/m/server']);
  const client = clientArgs(validateSettings({ ...defaults(), mods }));
  assert.ok(client.includes('-mod=C:/m/shared;C:/m/client')); assert.ok(!client.join(' ').includes('C:/m/server'));
});

test('diagnostics separate server and game requirements and give actionable errors', async () => {
  const { diagnostics } = await import('../src/discovery.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-diag-'));
  try {
    const s = { ...defaults(), port: 24500 + (process.pid % 100) * 10, rconEnabled: true, rconPassword: 'x'.repeat(12), mods: [{ path: path.join(dir, 'missing-mod'), enabled: true, scope: 'server' }] };
    const result = await diagnostics(s, dir, false);
    const by = name => result.checks.find(c => c.name === name);
    assert.equal(by('Dedicated server executable').ok, false); assert.match(by('Dedicated server executable').detail, /Dedicated Server Installation/);
    assert.equal(by('Game executable (Join only)').warning, true);
    assert.equal(by('Profile directory').ok, true); assert.equal(by('UDP game ports').ok, true);
    assert.match(by('Mod: missing-mod').detail, /not found/); assert.ok(by('BattlEye server library'));
    assert.equal(result.canStart, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Stop tries RCon #shutdown first and only kills if the server does not exit', () => fixture(async ({ manager, s, children }) => {
  await manager.start({ ...s, rconEnabled: false });
  let asked = 0; manager.gracefulStop = async () => { asked++; return true; };
  await manager.stop();
  assert.equal(asked, 0, 'no RCon: straight to process stop');
  manager.deps.gracefulStopMs = 50;
  manager.activeSettings = null;
  await manager.start(s); manager.activeSettings.rconEnabled = true;
  let killed = 0; const child = manager.child; const kill = child.kill; child.kill = sig => { killed++; kill(sig); };
  manager.gracefulStop = async () => { asked++; setTimeout(() => child.emit('close', 0, null), 5); return true; };
  await manager.stop();
  assert.equal(asked, 1); assert.equal(killed, 0); assert.equal(manager.status().state, 'stopped');
  await manager.start(s); manager.activeSettings.rconEnabled = true;
  const stubborn = manager.child; let forced = 0; const original = stubborn.kill; stubborn.kill = sig => { forced++; original(sig); };
  manager.gracefulStop = async () => true;
  await manager.stop();
  assert.ok(forced >= 1); assert.equal(manager.status().state, 'stopped'); assert.equal(children.length, 3);
}));

test('readiness is only reported after the server log shows it, and resets on restart', () => fixture(async ({ manager, s, logs }) => {
  await manager.start(s);
  assert.equal(manager.status().ready, null);
  logs.add('11:00:00 Host identity created.', 'rpt');
  assert.equal(manager.status().ready.stage, 'online');
  logs.add('11:00:05 Game started.', 'rpt');
  assert.equal(manager.status().ready.stage, 'mission');
  logs.add('Game started.', 'app');
  await manager.restart(s);
  assert.equal(manager.status().ready, null);
  logs.add('Game started.', 'app');
  assert.equal(manager.status().ready, null, 'app messages never count as readiness');
}));

test('Test server is up queries the Steam query port and reports failures honestly', () => fixture(async ({ manager, s }) => {
  await assert.rejects(manager.query(), /Start the dedicated server first/);
  const calls = [];
  manager.deps.queryServer = async (host, port) => { calls.push([host, port]); return { name: 'Ops', map: 'Altis', players: 1, maxPlayers: 16, latencyMs: 4 }; };
  await manager.start(s);
  const up = await manager.query();
  assert.equal(up.ok, true); assert.deepEqual(calls[0], ['127.0.0.1', s.port + 1]); assert.match(up.message, /Server is up.*Ops.*1\/16/);
  assert.equal(manager.status().ready.stage, 'online');
  manager.deps.queryServer = async () => { throw new Error('No reply from 127.0.0.1'); };
  const down = await manager.query();
  assert.equal(down.ok, false); assert.match(down.message, /No reply.*loading/);
}));

test('auto-restart relaunches only the dedicated server after a crash, with a limit', () => fixture(async ({ manager, s, spawns, gameCalls, serverExe }) => {
  Object.assign(manager.deps, { autoRestartDelayMs: 10, autoRestartLimit: 2 });
  await manager.start({ ...s, autoRestart: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async check => { for (let i = 0; i < 100 && !check(); i++) await wait(10); };
  manager.child.emit('close', 3221225477, null);
  await until(() => manager.status().state === 'running' && spawns.length === 2);
  assert.equal(spawns.length, 2); assert.ok(spawns.every(c => c.exe === serverExe)); assert.equal(gameCalls.length, 0);
  manager.child.emit('close', 1, null);
  await until(() => manager.status().state === 'running' && spawns.length === 3);
  manager.child.emit('close', 1, null);
  await wait(60);
  assert.equal(spawns.length, 3); assert.equal(manager.status().state, 'failed'); assert.match(manager.status().lastError, /gave up/);
}));

test('auto-restart stays off by default, on clean exits and after an explicit stop', () => fixture(async ({ manager, s, spawns }) => {
  manager.deps.autoRestartDelayMs = 10;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await manager.start(s); manager.child.emit('close', 1, null); await wait(40);
  assert.equal(spawns.length, 1); assert.equal(manager.status().state, 'failed');
  await manager.start({ ...s, autoRestart: true }); manager.child.emit('close', 0, null); await wait(40);
  assert.equal(spawns.length, 2); assert.equal(manager.status().state, 'stopped');
  await manager.start({ ...s, autoRestart: true }); await manager.stop(); await wait(40);
  assert.equal(spawns.length, 3); assert.equal(manager.status().state, 'stopped');
  assert.equal(validateSettings({ serverName: 'Legacy' }).autoRestart, false);
  assert.throws(() => validateSettings({ ...defaults(), autoRestart: 'yes' }), /autoRestart/);
}));

test('Join does not use a mod that was removed from the Mods list after the server started', () => fixture(async ({ manager, s, dir, gameCalls }) => {
  const ghost = path.join(dir, '@RemovedClientMod');
  await manager.start({ ...s, mods: [{ path: ghost, enabled: true, scope: 'client' }] });
  const saved = { ...s, mods: [] }; // user removed the mod and is testing vanilla
  const result = await manager.join(saved);
  assert.match(result.message, /Game launch/);
  assert.deepEqual(gameCalls[0].mods, [], 'removed client-only mod must not be passed to the game');
}));

test('a stale snapshot recovered after an app restart does not block vanilla Join', () => fixture(async ({ manager, s, dir, gameCalls }) => {
  const ghost = path.join(dir, '@OldSessionMod');
  await manager.start({ ...s, mods: [{ path: ghost, enabled: true, scope: 'client' }] });
  const recovered = new ProcessManager({ dir, logs: new LogBook(dir), deps: manager.deps });
  await recovered.restore();
  await recovered.join({ ...s, mods: [] });
  assert.deepEqual(gameCalls.at(-1).mods, []);
  await recovered.close({ leaveRunning: true });
}));

test('a shared mod still loaded on the running server is explained, not reported as an unknown mod', () => fixture(async ({ manager, s, dir }) => {
  const mod = path.join(dir, '@SharedMod'); await mkdir(mod);
  await manager.start({ ...s, mods: [{ path: mod, enabled: true, scope: 'shared' }] });
  await rm(mod, { recursive: true });
  await assert.rejects(manager.join({ ...s, mods: [] }), /running server was started with.*@SharedMod.*no longer in your Mods list.*Restart Server/s);
}));

test('Join adds current client-only mods to the running server\'s shared mods', () => fixture(async ({ manager, s, dir, gameCalls }) => {
  const shared = path.join(dir, '@Shared'), client = path.join(dir, '@ClientNew'), server = path.join(dir, '@ServerOnly');
  for (const p of [shared, client, server]) await mkdir(p);
  await manager.start({ ...s, mods: [{ path: shared, enabled: true, scope: 'shared' }, { path: server, enabled: true, scope: 'server' }] });
  await manager.join({ ...s, mods: [{ path: shared, enabled: true, scope: 'shared' }, { path: client, enabled: true, scope: 'client' }] });
  assert.deepEqual(gameCalls[0].mods.map(m => m.path), [shared, client]);
  assert.ok(clientArgs(gameCalls[0]).includes(`-mod=${shared};${client}`));
}));

test('game launch skips the menu scene by default and adds -hugePages only when chosen', () => {
  const base = validateSettings(defaults());
  assert.equal(base.fastJoin, true); assert.equal(base.hugePages, false);
  const args = clientArgs(base);
  assert.ok(args.includes('-world=empty')); assert.ok(!args.includes('-hugePages'));
  assert.ok(args.indexOf('-world=empty') < args.findIndex(a => a.startsWith('-connect=')));
  assert.ok(!clientArgs(validateSettings({ ...defaults(), fastJoin: false })).includes('-world=empty'));
  assert.ok(clientArgs(validateSettings({ ...defaults(), hugePages: true })).includes('-hugePages'));
  assert.ok(clientArgs(base, { host: '1.2.3.4', port: 2402, password: '' }).includes('-world=empty'), 'applies to joining a friend too');
  for (const key of ['fastJoin', 'hugePages']) assert.throws(() => validateSettings({ ...defaults(), [key]: 'yes' }), new RegExp(key));
});

test('Join while the server is still loading waits, then launches once the server is online', () => fixture(async ({ manager, s, spawns, gameCalls, logs }) => {
  manager.deps.joinPollMs = 10; manager.deps.joinQueryMs = 0; manager.deps.queryServer = async () => { throw new Error('No reply'); };
  await manager.start(s);
  const result = await manager.join(s, { whenReady: true });
  assert.equal(result.waiting, true); assert.match(result.message, /launch automatically/);
  assert.equal(gameCalls.length, 0); assert.ok(manager.status().pendingJoin);
  assert.equal(manager.busy, null, 'waiting must not lock Stop/Restart');
  logs.add('12:00:00 Host identity created.', 'rpt');
  for (let i = 0; i < 50 && !gameCalls.length; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(gameCalls.length, 1); assert.equal(manager.status().pendingJoin, null);
  assert.equal(spawns.length, 2);
}));

test('a successful server query also releases a waiting Join', () => fixture(async ({ manager, s, gameCalls }) => {
  manager.deps.joinPollMs = 10; manager.deps.joinQueryMs = 0; let up = false;
  manager.deps.queryServer = async () => { if (!up) throw new Error('No reply'); return { name: 'x', players: 0, maxPlayers: 1, latencyMs: 1 }; };
  await manager.start(s); await manager.join(s, { whenReady: true });
  up = true;
  for (let i = 0; i < 50 && !gameCalls.length; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(gameCalls.length, 1);
}));

test('Join launches immediately when the server is already online or when asked to', () => fixture(async ({ manager, s, gameCalls, logs }) => {
  await manager.start(s);
  logs.add('Host identity created.', 'rpt');
  const ready = await manager.join(s, { whenReady: true });
  assert.ok(!ready.waiting); assert.equal(gameCalls.length, 1);
}));

test('a waiting Join can be cancelled, is cancelled by Stop, and times out with a clear message', () => fixture(async ({ manager, s, gameCalls }) => {
  Object.assign(manager.deps, { joinPollMs: 10, joinQueryMs: 0, joinWaitMs: 60, queryServer: async () => { throw new Error('No reply'); } });
  await manager.start(s);
  await manager.join(s, { whenReady: true });
  assert.equal(manager.cancelJoin().pendingJoin, null);
  await manager.join(s, { whenReady: true });
  await manager.stop();
  assert.equal(manager.status().pendingJoin, null);
  await manager.start(s);
  await manager.join(s, { whenReady: true });
  for (let i = 0; i < 30 && manager.status().pendingJoin; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(manager.status().pendingJoin, null); assert.match(manager.status().lastError, /did not come online/);
  assert.equal(gameCalls.length, 0);
  await assert.rejects(manager.join(s, { whenReady: true }).then(() => manager.join(s, { whenReady: true })), /already waiting/i);
}));

test('Launcher join falls back to Steam when arma3launcher.exe is not found and starts no game process', () => fixture(async ({ manager, s, spawns, gameCalls, opened, dir }) => {
  const mod = path.join(dir, '@CBA_A3'); await mkdir(mod);
  await manager.start({ ...s, joinMethod: 'launcher', password: 'pw', mods: [{ path: mod, enabled: true, scope: 'shared' }] });
  const result = await manager.join({ ...s, joinMethod: 'launcher', gameExe: '' });
  assert.equal(result.launcher, true); assert.equal(result.viaSteam, true); assert.match(result.message, /Couldn't find arma3launcher\.exe/);
  assert.deepEqual(opened, ['steam://run/107410']);
  assert.equal(spawns.length, 1, 'only the dedicated server was started'); assert.equal(gameCalls.length, 0);
  assert.deepEqual(result.connect, { host: '127.0.0.1', port: s.port, hasPassword: true });
  assert.match(result.message, /Direct Connect: 127\.0\.0\.1 port \d+ \(use your join password\).*@CBA_A3/);
  assert.ok(!JSON.stringify(result).includes('"pw"'), 'the password itself is not returned');
}));

test('Launcher join lists running Arma processes instead of opening a second copy; joining a friend uses their address', () => fixture(async ({ manager, s, opened, spawns }) => {
  await manager.start({ ...s, joinMethod: 'launcher' });
  const server = manager.status().pid;
  manager.deps.armaProcesses = async () => ({ games: [{ name: 'arma3_x64.exe', pid: 5 }], battleye: [], launchers: [], servers: [{ name: 'arma3server_x64.exe', pid: server }] });
  const blocked = await manager.join({ ...s, joinMethod: 'launcher' });
  assert.equal(blocked.launcher, false); assert.match(blocked.message, /already running: arma3_x64\.exe \(PID 5\).*stuck/);
  assert.deepEqual(blocked.running, [
    { name: 'arma3_x64.exe', pid: 5, role: 'Game', closable: true },
    { name: 'arma3server_x64.exe', pid: server, role: 'Dedicated server (started by ArmaHost)', closable: false }]);
  assert.equal(opened.length, 0); assert.equal(spawns.length, 1, 'nothing but the server was started');
  manager.deps.armaProcesses = async () => ({ games: [], servers: [] });
  const remote = await manager.joinRemote({ ...defaults(), joinMethod: 'launcher', remoteHost: 'friend.example.com', remotePort: 2402 });
  assert.deepEqual(remote.connect, { host: 'friend.example.com', port: 2402, hasPassword: false });
  assert.deepEqual(opened, ['steam://run/107410']);
}));

test('Open Arma 3 Launcher starts arma3launcher.exe from the game folder without a server, Steam or arguments', () => fixture(async ({ manager, s, spawns, opened, gameDir, serverExe, gameExe, logs }) => {
  const launcher = path.join(gameDir, 'arma3launcher.exe'); await writeFile(launcher, '');
  const result = await manager.openLauncherOnly({ ...s, joinMethod: 'launcher' });
  assert.equal(result.launcher, true); assert.equal(result.viaSteam, false); assert.equal(result.connect, null);
  assert.match(result.message, /^Opening the Arma 3 Launcher\.$/);
  assert.equal(spawns.length, 1); assert.equal(spawns[0].exe, launcher); assert.deepEqual(spawns[0].args, []);
  assert.equal(spawns[0].options.shell, false); assert.equal(spawns[0].options.detached, true); assert.equal(spawns[0].options.cwd, gameDir);
  assert.ok(!spawns.some(c => c.exe === serverExe || c.exe === gameExe)); assert.equal(opened.length, 0);
  assert.ok(logs.since(0).entries.some(e => /Opened Arma 3 Launcher: .*arma3launcher\.exe \(PID 4000\)/.test(e.message)));
  assert.equal(manager.status().state, 'stopped', 'opening the launcher never starts the server');
  await assert.rejects(manager.openLauncherOnly(s), /just opened/);
}));

test('with the server running, Open Arma 3 Launcher includes its address; launcher Join opens at once while the server loads', () => fixture(async ({ manager, s, spawns, gameDir, serverExe }) => {
  const launcher = path.join(gameDir, 'arma3launcher.exe'); await writeFile(launcher, '');
  await manager.start(s); // started with joinMethod "direct"
  assert.equal(manager.status().ready, null, 'server still loading');
  const result = await manager.join({ ...s, joinMethod: 'launcher' }, { whenReady: true });
  assert.equal(result.waiting, undefined); assert.equal(manager.status().pendingJoin, null);
  assert.equal(result.launcher, true, 'the saved join method wins over the one the server started with');
  assert.deepEqual(result.connect, { host: '127.0.0.1', port: s.port, hasPassword: false });
  assert.equal(spawns.length, 2); assert.equal(spawns[0].exe, serverExe); assert.equal(spawns[1].exe, launcher);
  manager.lastJoin = 0;
  manager.deps.armaProcesses = async () => ({ games: [], battleye: [], launchers: [{ name: 'arma3launcher.exe', pid: 77 }], servers: [] });
  const open = await manager.openLauncherOnly({ ...s, joinMethod: 'launcher' });
  assert.equal(open.alreadyOpen, true); assert.match(open.message, /already open \(PID 77\).*Direct Connect: 127\.0\.0\.1 port/);
  assert.equal(spawns.length, 2, 'no second launcher');
}));

test('closing Arma ends only game-side processes, never a dedicated server', () => fixture(async ({ manager, s, killed }) => {
  await manager.start(s);
  const own = manager.status().pid;
  const processes = { games: [{ name: 'arma3_x64.exe', pid: 5 }, { name: 'arma3_x64.exe', pid: 6 }], battleye: [{ name: 'Arma3BattlEye.exe', pid: 8 }], launchers: [{ name: 'arma3launcher.exe', pid: 7 }],
    servers: [{ name: 'arma3server_x64.exe', pid: own }, { name: 'arma3server_x64.exe', pid: 9 }] };
  manager.deps.armaProcesses = async () => ({ ...processes, games: processes.games.filter(p => !killed.includes(p.pid)) });
  await assert.rejects(manager.closeGame([5, own]), /dedicated server/);
  await assert.rejects(manager.closeGame([]), /Choose/); await assert.rejects(manager.closeGame(['5']), /Choose/);
  const result = await manager.closeGame([5, 6, 7, 8, 9]);
  assert.deepEqual(killed, [5, 6, 7, 8]);
  assert.equal(result.results.find(r => r.pid === 9).ok, false, 'another dedicated server is never closed');
  assert.match(result.message, /Closed 4 of 5/);
  assert.equal(manager.status().state, 'running');
  const status = await manager.armaStatus();
  assert.ok(status.processes.some(p => p.pid === own && p.role === 'Dedicated server (started by ArmaHost)' && !p.closable));
}));

test('endGameProcesses re-checks names and explains access denied', async () => {
  const list = async () => ({ games: [{ name: 'arma3_x64.exe', pid: 10 }], servers: [{ name: 'arma3server.exe', pid: 11 }], launchers: [], battleye: [] });
  const denied = Object.assign(new Error('Command failed'), { stderr: 'ERROR: The process with PID 10 could not be terminated. Reason: Access is denied.' });
  const results = await endGameProcesses([10, 11, 12], { list, kill: async () => { throw denied; } });
  assert.match(results[0].message, /access denied.*Task Manager/i);
  assert.equal(results[1].ok, false); assert.equal(results[2].ok, false);
});

test('diagnostics list running Arma processes and flag two copies of the game', async () => {
  const { diagnostics } = await import('../src/discovery.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-diag-'));
  try {
    const s = { ...defaults(), port: 24700 + (process.pid % 100) * 10 };
    const two = [{ name: 'arma3_x64.exe', pid: 5, role: 'Game', closable: true }, { name: 'arma3_x64.exe', pid: 6, role: 'Game', closable: true }];
    let row = (await diagnostics(s, dir, false, { processes: two })).checks.find(c => c.name === 'Running Arma processes');
    assert.equal(row.ok, false); assert.match(row.detail, /PID 5: Game; .*PID 6: Game.*More than one copy/);
    const normal = [two[0], { name: 'arma3server_x64.exe', pid: 7, role: 'Dedicated server (started by ArmaHost)', closable: false }];
    row = (await diagnostics(s, dir, false, { processes: normal })).checks.find(c => c.name === 'Running Arma processes');
    assert.equal(row.ok, true);
    row = (await diagnostics(s, dir, false, { processes: [] })).checks.find(c => c.name === 'Running Arma processes');
    assert.equal(row.detail, 'None running.');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('join method and UPnP settings are validated; UPnP only applies when hosting directly', () => {
  assert.equal(validateSettings(defaults()).joinMethod, 'launcher');
  assert.throws(() => validateSettings({ ...defaults(), joinMethod: 'cmd.exe' }), /Join method/);
  const cfg = settings => renderConfig(validateSettings({ ...defaults(), password: 'pw', ...settings }));
  assert.match(cfg({ upnp: true }), /upnp = 0;/, 'not when only this PC can join');
  assert.match(cfg({ upnp: true, audience: 'internet' }), /upnp = 1;/);
  assert.match(cfg({ upnp: true, audience: 'home' }), /upnp = 0;/, 'not for a home network');
  assert.match(cfg({ upnp: false, lan: true }), /upnp = 0;/);
  assert.match(cfg({ upnp: true, starlink: true, starlinkVpn: true, vpnIp: '100.64.1.2' }), /upnp = 0;/, 'not over a VPN');
});

test('if arma3launcher.exe does not stay open, Steam is asked instead and the result says so', () => fixture(async ({ manager, s, spawns, opened, gameDir }) => {
  const launcher = path.join(gameDir, 'arma3launcher.exe'); await writeFile(launcher, '');
  manager.deps.launchVerifyMs = 60; manager.deps.launchPollMs = 10;
  const result = await manager.openLauncherOnly(s);
  assert.equal(spawns[0].exe, launcher);
  assert.equal(result.verified, false); assert.equal(result.viaSteam, true); assert.match(result.message, /closed straight after starting.*Steam/);
  assert.deepEqual(opened, ['steam://run/107410']);
  manager.lastJoin = 0; opened.length = 0;
  let calls = 0;
  manager.deps.armaProcesses = async () => (++calls > 1 ? { games: [], servers: [], battleye: [], launchers: [{ name: 'arma3launcher.exe', pid: 91 }] } : { games: [], servers: [] });
  const ok = await manager.openLauncherOnly(s);
  assert.equal(ok.verified, true); assert.equal(ok.viaSteam, false); assert.deepEqual(opened, []);
}));
