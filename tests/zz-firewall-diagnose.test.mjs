// TEMPORARY: which program paths does New-NetFirewallRule accept on the runner? Removed before merge.
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { allowScript } from '../src/firewall.mjs';
const run = promisify(execFile);
test('diagnose firewall program paths', { skip: process.platform !== 'win32' }, async () => {
  const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = {
    programFilesSpaces: path.join(pf, 'ArmaHostDiag', 'Arma 3 Server', 'arma3server_x64.exe'),
    tempNoSpaces: path.join(os.tmpdir(), 'ahdiag', 'arma3server_x64.exe'),
    tempSpaces: path.join(os.tmpdir(), 'ahdiag', 'Arma 3 Server', 'arma3server_x64.exe'),
    workspace: path.join(process.cwd(), 'ahdiag', 'Arma 3 Server', 'arma3server_x64.exe'),
  };
  const cleanup = "Get-NetFirewallRule -Group 'ArmaHost' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue";
  for (const [name, file] of Object.entries(candidates)) {
    await mkdir(path.dirname(file), { recursive: true }); await copyFile(process.execPath, file);
    for (const p of [file, realpathSync.native(file)]) {
      const script = allowScript({ serverExe: p, port: 47330 }, ['Public']).replace("[Console]::Error.WriteLine($_.Exception.Message); exit 3", "'FAIL ' + $_.Exception.Message; exit 3").replace('exit 0', "'OK'; exit 0");
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]).catch(e => ({ stdout: `EXIT ${e.code} ${e.stdout}` }));
      console.log('DIAG', name, JSON.stringify(p), String(r.stdout).trim().slice(0, 200));
      await run('powershell.exe', ['-NoProfile', '-Command', cleanup]).catch(() => {});
    }
  }
});
