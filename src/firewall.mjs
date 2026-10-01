import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { AppError } from './config.mjs';
const execute = promisify(execFile);

// Windows Firewall helper for the dedicated server. It only ever creates, checks and removes rules in
// its own "ArmaHost" group, plus (when the user explicitly confirms) inbound block rules that target
// exactly the configured server executable. It never disables the firewall or touches other rules.
export const RULE_GROUP = 'ArmaHost';
export const ruleName = port => `ArmaHost Arma 3 server (UDP ${port}-${port + 4})`;
const literal = value => `'${String(value).replaceAll("'", "''")}'`; // PowerShell single-quoted string
const PROFILES = { Public: 'Public', Private: 'Private', DomainAuthenticated: 'Domain' };
export function firewallProfiles(networks) {
  const list = [...new Set((networks || []).map(n => PROFILES[n]).filter(Boolean))];
  return list.length ? list : ['Private'];
}
function checkInputs(s) {
  if (!s.serverExe || !path.win32.isAbsolute(s.serverExe) || /["\r\n`$]/.test(s.serverExe)) throw new AppError('Choose the dedicated server executable in Setup and save first.');
  if (!Number.isInteger(s.port) || s.port < 1024 || s.port > 65531) throw new AppError('Invalid game port.');
}
export function statusScript() {
  return `$ErrorActionPreference = 'SilentlyContinue'
$rule = Get-NetFirewallRule -Group '${RULE_GROUP}' | Where-Object { $_.DisplayName -eq $env:AH_NAME } | Select-Object -First 1
$others = @(Get-NetFirewallRule -Group '${RULE_GROUP}' | Where-Object { $_.DisplayName -ne $env:AH_NAME } | ForEach-Object { [string]$_.DisplayName })
$networks = @(Get-NetConnectionProfile | ForEach-Object { [string]$_.NetworkCategory })
$blocks = @(Get-NetFirewallApplicationFilter -Program $env:AH_PROGRAM | Get-NetFirewallRule | Where-Object { [string]$_.Action -eq 'Block' -and [string]$_.Direction -eq 'Inbound' -and [string]$_.Enabled -eq 'True' } | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; displayName = [string]$_.DisplayName; profile = [string]$_.Profile } })
$ports = ''; $program = ''
if ($rule) { $ports = [string](($rule | Get-NetFirewallPortFilter).LocalPort -join ','); $program = [string]($rule | Get-NetFirewallApplicationFilter).Program }
[pscustomobject]@{ exists = [bool]$rule; enabled = [bool]($rule -and [string]$rule.Enabled -eq 'True'); profile = $(if ($rule) { [string]$rule.Profile } else { '' }); ports = $ports; program = $program; others = $others; networks = $networks; blocks = $blocks } | ConvertTo-Json -Compress -Depth 4`;
}
export function allowScript(s, profiles) {
  checkInputs(s);
  // $ProgressPreference keeps PowerShell's module-loading progress out of the error output.
  const profile = profiles.filter(p => ['Public', 'Private', 'Domain'].includes(p)).join(',') || 'Private';
  return `$ProgressPreference = 'SilentlyContinue'
try { Get-NetFirewallRule -Group '${RULE_GROUP}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue } catch { }
try {
  New-NetFirewallRule -DisplayName ${literal(ruleName(s.port))} -Group '${RULE_GROUP}' -Description 'Added by ArmaHost Desktop for the Arma 3 dedicated server. Remove it from ArmaHost Setup.' -Direction Inbound -Action Allow -Protocol UDP -LocalPort '${s.port}-${s.port + 4}' -Program ${literal(s.serverExe)} -Profile '${profile}' -ErrorAction Stop | Out-Null
  exit 0
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`;
}
export function removeScript() {
  return `try { Get-NetFirewallRule -Group '${RULE_GROUP}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`;
}
export function removeBlocksScript(names) {
  if (!names.length || names.length > 40 || !names.every(n => typeof n === 'string' && n.length > 0 && n.length < 300)) throw new AppError('No block rules to remove.');
  return `try { Get-NetFirewallRule -Name ${names.map(literal).join(',')} -ErrorAction Stop | Where-Object { [string]$_.Action -eq 'Block' } | Remove-NetFirewallRule -ErrorAction Stop; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`;
}
const encode = script => Buffer.from(script, 'utf16le').toString('base64');

export class Firewall {
  constructor({ platform = process.platform, run = execute, demo = false } = {}) { this.platform = platform; this.run = run; this.demo = demo; }
  supported() { return !this.demo && this.platform === 'win32'; }
  async powershell(args, options = {}) {
    return this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024, ...options });
  }
  async elevated() {
    try {
      const { stdout } = await this.powershell(['-Command', '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)']);
      return stdout.trim() === 'True';
    } catch { return false; }
  }
  // Runs a change script with administrator rights: directly when ArmaHost already has them,
  // otherwise through the Windows admin (UAC) prompt. The script is passed encoded, never via a shell.
  async runAsAdmin(script) {
    const encoded = encode(script);
    try {
      if (await this.elevated()) await this.powershell(['-EncodedCommand', encoded]);
      else await this.powershell(['-Command', `$p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; exit $p.ExitCode`]);
    } catch (error) {
      const text = `${error.stderr || ''} ${error.message || ''}`;
      if (/cancel/i.test(text)) throw new AppError('The Windows admin prompt was declined, so nothing was changed. You can add the rule yourself with the command shown below.', 409);
      // PowerShell may wrap stderr in CLIXML progress records; keep only the readable message.
      const reason = String(error.stderr || '').replace(/#<\s*CLIXML/g, '').replace(/<Objs[\s\S]*$/, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new AppError(`Windows Firewall was not changed (${error.code === 3 ? 'Windows refused the rule' : 'the change failed'}${reason ? `: ${reason}` : ''}). You can add the rule yourself with the command shown below.`, 500);
    }
  }
  async status(input) {
    if (!this.supported()) return { supported: false, message: this.demo ? 'Demo mode: Windows Firewall is not checked.' : 'Windows Firewall checks are only available on Windows.' };
    const s = await this.resolved(input);
    let raw;
    try {
      const { stdout } = await this.powershell(['-Command', statusScript()], { env: { ...process.env, AH_NAME: ruleName(s.port), AH_PROGRAM: path.win32.normalize(s.serverExe) } });
      raw = JSON.parse(stdout.trim() || '{}');
    } catch { return { supported: true, error: 'Could not read Windows Firewall settings.' }; }
    const list = v => (Array.isArray(v) ? v : v ? [v] : []);
    const ok = raw.exists && raw.enabled && String(raw.ports) === `${s.port}-${s.port + 4}` && path.win32.normalize(raw.program || '').toLowerCase() === path.win32.normalize(s.serverExe).toLowerCase();
    const networks = list(raw.networks);
    const blocks = list(raw.blocks).map(b => ({ name: String(b.name), displayName: String(b.displayName), profile: String(b.profile) }));
    return { supported: true, name: ruleName(s.port), exists: Boolean(raw.exists), ok, profile: raw.profile || '', networks, profiles: firewallProfiles(networks),
      stale: list(raw.others).map(String), blocks,
      message: blocks.length ? `Windows has ${blocks.length} rule(s) blocking this server program. Blocking rules win over allow rules, so friends can't connect until they are removed.`
        : ok ? `Allowed: inbound UDP ${s.port}-${s.port + 4} for this server on ${raw.profile} networks.`
        : raw.exists ? 'An ArmaHost rule exists but is for a different port or program. Press Allow again to update it.'
        : 'No ArmaHost rule yet. Windows may block friends from reaching the server.' };
  }
  // Windows Firewall wants the program's real full path (not a short 8.3 form like RUNNER~1).
  async resolved(s) { checkInputs(s); try { return { ...s, serverExe: realpathSync.native(s.serverExe) }; } catch { return s; } }
  async allow(input) {
    if (!this.supported()) throw new AppError('Windows Firewall changes are only available on Windows.');
    const s = await this.resolved(input);
    const before = await this.status(s);
    await this.runAsAdmin(allowScript(s, before.profiles || ['Private']));
    const after = await this.status(s);
    if (!after.ok) throw new AppError('The rule could not be confirmed after adding it. Check Windows Defender Firewall > Advanced settings > Inbound Rules.', 500);
    return after;
  }
  async remove(s) {
    if (!this.supported()) throw new AppError('Windows Firewall changes are only available on Windows.');
    await this.runAsAdmin(removeScript());
    return this.status(s);
  }
  // Removes only inbound block rules whose program is exactly this server executable, re-read now.
  async removeBlocks(s) {
    if (!this.supported()) throw new AppError('Windows Firewall changes are only available on Windows.');
    const current = await this.status(s);
    if (!current.blocks?.length) return current;
    await this.runAsAdmin(removeBlocksScript(current.blocks.map(b => b.name)));
    return this.status(s);
  }
}
