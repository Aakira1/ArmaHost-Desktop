// TEMPORARY: finds which part of the real allow script the Windows runner rejects. Removed before merge.
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { allowScript } from '../src/firewall.mjs';
const run = promisify(execFile);
test('diagnose firewall allow script', { skip: process.platform !== 'win32' }, async () => {
  const s = { serverExe: process.execPath, port: 47320 };
  const cleanup = "Get-NetFirewallRule -Group 'ArmaHost' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue";
  for (const profiles of [['Public'], ['Private'], ['Public', 'Private']]) {
    const script = allowScript(s, profiles).replace("[Console]::Error.WriteLine($_.Exception.Message); exit 3", "'FAIL ' + $_.Exception.Message + ' | ' + $_.FullyQualifiedErrorId; exit 3").replace('exit 0', "'OK'; exit 0");
    for (const mode of ['command', 'encoded']) {
      const args = mode === 'command' ? ['-NoProfile', '-NonInteractive', '-Command', script] : ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
      const r = await run('powershell.exe', args).catch(e => ({ stdout: `EXIT ${e.code} ${e.stdout}` }));
      console.log('DIAG', profiles.join(','), mode, String(r.stdout).trim().slice(0, 300));
      await run('powershell.exe', ['-NoProfile', '-Command', cleanup]).catch(() => {});
    }
  }
  console.log('SCRIPT', allowScript(s, ['Public']));
});
