import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clientArgs } from './config.mjs';
const execute = promisify(execFile);
export function gameLaunch(settings, connection) {
  const args = clientArgs(settings, connection);
  return settings.battleye
    ? { exe: path.join(path.dirname(settings.gameExe), 'arma3battleye.exe'), args: ['2', '1', '0', '-exe', path.basename(settings.gameExe), ...args] }
    : { exe: settings.gameExe, args };
}
export function parseArmaProcesses(csv) {
  const games = [], servers = [];
  for (const line of csv.split(/\r?\n/)) {
    const row = line.match(/^"(arma3(?:server)?(?:_x64)?\.exe)","(\d+)"/i);
    if (row) (/server/i.test(row[1]) ? servers : games).push({ name: row[1], pid: Number(row[2]) });
  }
  return { games, servers };
}
export async function armaProcesses() {
  if (process.platform !== 'win32') return { games: [], servers: [] };
  const { stdout } = await execute('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  return parseArmaProcesses(stdout);
}
export async function ownsServer(pid, exe, configFile) {
  if (!Number.isSafeInteger(pid) || pid < 1 || process.platform !== 'win32') return false;
  const script = '$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$env:ARMAHOST_CHECK_PID); if($p -and $p.ExecutablePath -eq $env:ARMAHOST_CHECK_EXE -and $p.CommandLine.Contains("-config="+$env:ARMAHOST_CHECK_CONFIG)){"owned"}';
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000, env: { ...process.env, ARMAHOST_CHECK_PID: String(pid), ARMAHOST_CHECK_EXE: path.win32.normalize(exe), ARMAHOST_CHECK_CONFIG: configFile } });
  return stdout.trim() === 'owned';
}
