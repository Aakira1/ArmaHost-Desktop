// TEMPORARY: finds which New-NetFirewallRule parameter the Windows runner rejects. Removed before merge.
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
test('diagnose firewall parameters', { skip: process.platform !== 'win32' }, async () => {
  const exe = process.execPath.replaceAll("'", "''");
  const base = "-Direction Inbound -Action Allow -Protocol UDP";
  const variants = {
    minimal: `${base} -LocalPort 47310`,
    range: `${base} -LocalPort '47310-47314'`,
    program: `${base} -LocalPort 47310 -Program '${exe}'`,
    profilePrivate: `${base} -LocalPort 47310 -Profile 'Private'`,
    profileAny: `${base} -LocalPort 47310 -Profile Any`,
    group: `${base} -LocalPort 47310 -Group 'ArmaHostDiag'`,
    description: `${base} -LocalPort 47310 -Description 'Added by ArmaHost Desktop for the Arma 3 dedicated server. Remove it from ArmaHost Setup.'`,
    displayParens: `${base} -LocalPort 47310`,
  };
  const profiles = await run('powershell.exe', ['-NoProfile', '-Command', 'Get-NetConnectionProfile | Format-List Name,NetworkCategory | Out-String; Get-Service MpsSvc | Format-List Status | Out-String']).catch(e => ({ stdout: e.message }));
  console.log('PROFILES', profiles.stdout);
  for (const [name, params] of Object.entries(variants)) {
    const display = name === 'displayParens' ? 'ArmaHost diag (UDP 1-2)' : `ArmaHostDiag ${name}`;
    const script = `$ProgressPreference='SilentlyContinue'; try { New-NetFirewallRule -DisplayName '${display}' ${params} -ErrorAction Stop | Out-Null; 'OK' } catch { 'FAIL ' + $_.Exception.Message } finally { Get-NetFirewallRule -DisplayName '${display}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue }`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).catch(e => ({ stdout: 'ERR ' + e.message }));
    console.log('DIAG', name, r.stdout.trim());
  }
});
