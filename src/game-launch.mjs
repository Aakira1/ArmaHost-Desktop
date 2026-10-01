import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clientArgs } from './config.mjs';
import { isFile, discoverInstallations } from './discovery.mjs';
const execute = promisify(execFile);
export const LAUNCHER_EXE = 'arma3launcher.exe';
// Only these game-side processes may ever be closed by ArmaHost. Dedicated servers never are.
export const CLIENT_PROCESS_NAMES = ['arma3_x64.exe', 'arma3.exe', 'arma3battleye.exe', LAUNCHER_EXE];
export function gameLaunch(settings, connection) {
  const args = clientArgs(settings, connection);
  return settings.battleye
    ? { exe: path.join(path.dirname(settings.gameExe), 'arma3battleye.exe'), args: ['2', '1', '0', '-exe', path.basename(settings.gameExe), ...args] }
    : { exe: settings.gameExe, args };
}
export function parseArmaProcesses(csv) {
  const games = [], servers = [], launchers = [], battleye = [];
  for (const line of csv.split(/\r?\n/)) {
    const row = line.match(/^"(arma3(?:server|launcher|battleye)?(?:_x64)?\.exe)","(\d+)"/i);
    if (!row) continue;
    const name = row[1].toLowerCase(); const entry = { name: row[1], pid: Number(row[2]) };
    (name.startsWith('arma3server') ? servers : name.startsWith('arma3launcher') ? launchers : name.startsWith('arma3battleye') ? battleye : games).push(entry);
  }
  return { games, servers, launchers, battleye };
}
export async function armaProcesses() {
  if (process.platform !== 'win32') return { games: [], servers: [], launchers: [], battleye: [] };
  const { stdout } = await execute('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  return parseArmaProcesses(stdout);
}
// The official Arma 3 Launcher sits next to the game executable. Falls back to the Arma 3 folders
// found in the Steam libraries when the game path isn't set (or points somewhere else).
export async function findLauncher(gameExe, discover = discoverInstallations) {
  const near = gameExe ? path.join(path.dirname(gameExe), LAUNCHER_EXE) : '';
  if (near && await isFile(near)) return near;
  try {
    for (const game of (await discover()).games) {
      const candidate = path.join(path.dirname(game), LAUNCHER_EXE);
      if (await isFile(candidate)) return candidate;
    }
  } catch { /* Fall back to Steam. */ }
  return null;
}
async function taskkill(pid) {
  await execute('taskkill.exe', ['/PID', String(pid), '/F'], { windowsHide: true, timeout: 10000 });
}
// Ends the given game-side processes. The list is re-read first and a PID is only ended if it is
// still an Arma 3 game, BattlEye or launcher process, so a reused PID or a server is never touched.
export async function endGameProcesses(pids, { list = armaProcesses, kill = taskkill } = {}) {
  const current = await list();
  const clients = [...current.games, ...(current.battleye || []), ...(current.launchers || [])]
    .filter(p => CLIENT_PROCESS_NAMES.includes(p.name.toLowerCase()));
  const results = [];
  for (const pid of new Set(pids)) {
    const match = clients.find(p => p.pid === pid);
    if (!match) { results.push({ pid, ok: false, message: 'Not running any more, or not an Arma 3 game/launcher process.' }); continue; }
    try { await kill(pid); results.push({ pid, name: match.name, ok: true }); }
    catch (error) {
      const denied = /access is denied|access denied/i.test(`${error.stderr || ''} ${error.message || ''}`);
      results.push({ pid, name: match.name, ok: false, message: denied ? 'Windows refused (access denied). End it in Task Manager or restart the PC.' : 'Could not close it. End it in Task Manager or restart the PC.' });
    }
  }
  return results;
}
export async function ownsServer(pid, exe, configFile) {
  if (!Number.isSafeInteger(pid) || pid < 1 || process.platform !== 'win32') return false;
  const script = '$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$env:ARMAHOST_CHECK_PID); if($p -and $p.ExecutablePath -eq $env:ARMAHOST_CHECK_EXE -and $p.CommandLine.Contains("-config="+$env:ARMAHOST_CHECK_CONFIG)){"owned"}';
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000, env: { ...process.env, ARMAHOST_CHECK_PID: String(pid), ARMAHOST_CHECK_EXE: path.win32.normalize(exe), ARMAHOST_CHECK_CONFIG: configFile } });
  return stdout.trim() === 'owned';
}
