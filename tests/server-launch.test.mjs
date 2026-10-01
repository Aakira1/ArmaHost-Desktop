import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults, validateSettings, serverArgs, clientArgs, assertServerExecutable } from '../src/config.mjs';
import { ProcessManager } from '../src/process-manager.mjs';
import { LogBook } from '../src/logs.mjs';

let portBase = 23100 + (process.pid % 200) * 10;
async function fixture(fn, { deps = {}, settings = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-launch-'));
  const serverDir = path.join(dir, 'Arma 3 Server'); const gameDir = path.join(dir, 'Arma 3');
  await mkdir(serverDir); await mkdir(gameDir);
  const serverExe = path.join(serverDir, 'arma3server_x64.exe'); const gameExe = path.join(gameDir, 'arma3_x64.exe');
  for (const f of [serverExe, gameExe, path.join(gameDir, 'arma3battleye.exe')]) await writeFile(f, '');
  const spawns = []; const gameCalls = []; const children = [];
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
    spawn, platform: 'win32', startupGraceMs: 60,
    armaProcesses: async () => ({ games: [], servers: [] }), ownsServer: async () => true,
    gameLaunch: (s, c) => { gameCalls.push(s); return { exe: path.join(gameDir, 'arma3battleye.exe'), args: ['2', '1', '0'] }; }, ...deps } });
  const s = validateSettings({ ...defaults(), serverExe, gameExe, port: (portBase += 10), ...settings });
  try { await fn({ manager, s, spawns, gameCalls, children, fake, dir, serverExe, gameExe, logs }); }
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
