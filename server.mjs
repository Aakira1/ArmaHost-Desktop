import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from './src/http.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node server.mjs [--open] [--demo] [--port=3000]\nNode.js 22+ required. Live Arma launching requires Windows.');
  process.exit(0);
}
for (const arg of args) if (!['--open', '--demo'].includes(arg) && !/^--port=\d+$/.test(arg)) { console.error(`Unknown argument: ${arg}`); process.exit(1); }
if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Install Node.js 22 or newer (Node.js 24 LTS recommended).'); process.exit(1); }
const demo = args.includes('--demo');
const port = Number(args.find(a => a.startsWith('--port='))?.split('=')[1] || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('Dashboard port must be 1024–65535.'); process.exit(1); }
const dir = path.join(root, demo ? 'demo-data' : 'data');
const lockPath = path.join(dir, 'manager.lock');
let app; let ownsLock = false; let stopping = false;
async function releaseLock() { if (ownsLock) { await unlink(lockPath).catch(() => {}); ownsLock = false; } }
async function acquireLock() {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = await open(lockPath, 'wx', 0o600);
      try { await fd.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); }
      finally { await fd.close(); }
      ownsLock = true; return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = JSON.parse(await readFile(lockPath, 'utf8')); }
      catch { throw new Error(`Unreadable manager.lock. Confirm no Local Host is running, then remove ${lockPath}.`); }
      if (!Number.isInteger(previous.pid) || previous.pid < 1) throw new Error(`Invalid manager.lock. Inspect ${lockPath} before removing it.`);
      try { process.kill(previous.pid, 0); throw new Error(`Local Host already appears to be running (PID ${previous.pid}). Use its browser window, or stop it first.`); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      await unlink(lockPath);
      console.log('Removed a stale dashboard lock. Any old Arma process must be stopped manually before hosting again.');
    }
  }
  throw new Error('Could not acquire the application lock.');
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try { await app?.close(); await releaseLock(); process.exit(0); }
  catch (error) { console.error(`Shutdown failed: ${error.message}`); stopping = false; }
}
try {
  await acquireLock();
  app = await createApp({ root, dir, demo, port, onQuit: async () => { await releaseLock(); process.exit(0); } });
  const url = `${app.url}/#token=${app.token}`;
  console.log(`\n  ARMA 3 LOCAL HOST  /  ${demo ? 'DEMO — no game launching' : 'WINDOWS HOST MANAGER'}\n`);
  console.log(`  Private dashboard link:\n  ${url}\n`);
  console.log(`  Data: ${dir}\n  Keep this console open. Use Quit in the dashboard or Ctrl+C to stop.\n  The link grants local control: do not share it.\n`);
  if (args.includes('--open')) {
    let launcher;
    if (process.platform === 'win32') launcher = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [url], { detached: true, stdio: 'ignore', shell: false });
    else if (process.platform === 'darwin') launcher = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore', shell: false });
    if (launcher) { launcher.on('error', () => console.log('Browser did not open; copy the private link above.')); launcher.unref(); }
    else console.log('Open the private link above in your browser.');
  }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
} catch (error) {
  await releaseLock();
  console.error(error.code === 'EADDRINUSE' ? `\nDashboard port ${port} is busy. Close the other application, or run node server.mjs --open --port=3001.` : `\n${error.message}`);
  process.exitCode = 1;
}
