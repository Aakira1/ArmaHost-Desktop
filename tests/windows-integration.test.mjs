// Runs the real Windows commands (tasklist, taskkill, PowerShell firewall cmdlets) on the Windows CI
// runner. Skipped on other systems. Stand-in executables are copies of node.exe kept alive with a
// tiny script, so no real Arma or Steam is needed and nothing outside the temp folder is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { ProcessManager } from '../src/process-manager.mjs';
import { armaProcesses, findLauncher } from '../src/game-launch.mjs';
import { Firewall, ruleName } from '../src/firewall.mjs';
import { LogBook } from '../src/logs.mjs';
import { defaults, validateSettings } from '../src/config.mjs';

const windows = process.platform === 'win32';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function standIns(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-win-'));
  const gameDir = path.join(dir, 'Arma 3'); const serverDir = path.join(dir, 'Arma 3 Server');
  await mkdir(gameDir); await mkdir(serverDir);
  const keepalive = path.join(dir, 'keepalive.cjs'); await writeFile(keepalive, 'setInterval(() => {}, 1000);\n');
  const exe = name => path.join(name.startsWith('arma3server') ? serverDir : gameDir, name);
  for (const name of ['arma3launcher.exe', 'arma3_x64.exe', 'arma3server_x64.exe']) await copyFile(process.execPath, exe(name));
  const previous = process.env.NODE_OPTIONS;
  // NODE_OPTIONS treats backslashes inside quotes as escapes, so pass the path with forward slashes.
  process.env.NODE_OPTIONS = `--require "${keepalive.replaceAll('\\', '/')}"`;
  const started = [];
  t.after(async () => {
    process.env.NODE_OPTIONS = previous ?? '';
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    for (const pid of started) { try { process.kill(pid); } catch {} }
    const { games, launchers, servers } = await armaProcesses();
    for (const p of [...games, ...launchers, ...servers]) if (started.includes(p.pid)) { try { process.kill(p.pid); } catch {} }
    await sleep(300); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  return { dir, gameDir, exe, started };
}

test('Windows: Open Arma 3 Launcher starts the real arma3launcher.exe, tasklist sees it, and closing it works', { skip: !windows }, async t => {
  const { dir, exe, started } = await standIns(t);
  // A stand-in dedicated server that must never be closed.
  const server = spawn(exe('arma3server_x64.exe'), [], { detached: true, stdio: 'ignore' }); started.push(server.pid); server.unref();
  const logs = new LogBook(dir);
  const manager = new ProcessManager({ dir, logs, deps: { openUrl: () => assert.fail('Steam fallback must not be used'), closeWaitMs: 5000 } });
  const s = validateSettings({ ...defaults(), gameExe: exe('arma3_x64.exe') });
  assert.equal(await findLauncher(s.gameExe), exe('arma3launcher.exe'));
  try {
    const result = await manager.openLauncherOnly(s);
    assert.equal(result.launcher, true); assert.equal(result.verified, true, result.message); assert.equal(result.viaSteam, false);
    const listed = await armaProcesses();
    assert.equal(listed.launchers.length, 1, 'tasklist shows exactly one launcher');
    assert.ok(listed.servers.some(p => p.pid === server.pid));
    started.push(...listed.launchers.map(p => p.pid));
    // Pressing again does not open a second launcher.
    manager.lastJoin = 0;
    const again = await manager.openLauncherOnly(s);
    assert.equal(again.alreadyOpen, true); assert.equal((await armaProcesses()).launchers.length, 1);
    // Close: the launcher goes, the dedicated server stays.
    const closed = await manager.closeGame([listed.launchers[0].pid, server.pid]);
    assert.equal(closed.results.find(r => r.pid === listed.launchers[0].pid).ok, true);
    assert.equal(closed.results.find(r => r.pid === server.pid).ok, false);
    const after = await armaProcesses();
    assert.equal(after.launchers.length, 0); assert.ok(after.servers.some(p => p.pid === server.pid), 'the server survived');
    // A stuck game blocks the launcher and is reported with its PID.
    const game = spawn(exe('arma3_x64.exe'), [], { detached: true, stdio: 'ignore' }); started.push(game.pid); game.unref();
    await sleep(500); manager.lastJoin = 0;
    const blocked = await manager.openLauncherOnly(s);
    assert.equal(blocked.launcher, false); assert.ok(blocked.running.some(p => p.pid === game.pid && p.closable));
    assert.ok(blocked.running.some(p => p.pid === server.pid && !p.closable));
  } finally { await manager.close(); }
});

test('Windows: the firewall helper adds, confirms and removes its own rule', { skip: !windows }, async t => {
  const fw = new Firewall();
  if (!(await fw.elevated())) return t.skip('needs an administrator session (the CI runner is one)');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-fw-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const s = { serverExe: path.join(dir, 'Arma 3 Server', 'arma3server_x64.exe'), port: 47302 };
  try {
    const before = await fw.status(s);
    assert.equal(before.supported, true); assert.equal(before.exists, false); assert.ok(Array.isArray(before.networks));
    const after = await fw.allow(s);
    assert.equal(after.ok, true, after.message); assert.equal(after.name, ruleName(47302));
    const removed = await fw.remove(s);
    assert.equal(removed.exists, false);
  } finally { await fw.remove(s).catch(() => {}); }
});
