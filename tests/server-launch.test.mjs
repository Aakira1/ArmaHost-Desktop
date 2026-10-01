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
