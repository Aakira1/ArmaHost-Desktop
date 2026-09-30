import path from 'node:path';
import { usableAddress, publicAddress, bindAddress, gameAddress } from './network.mjs';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function defaults() {
  return {
    gameExe: '', serverExe: '', serverName: 'Arma 3 Local Operations',
    port: 2302, maxPlayers: 16, password: '', adminPassword: '',
    difficulty: 'Regular', mission: '', lan: false, battleye: true, starlink: false, vpnIp: '', starlinkVpn: false, publicIp: '',
    verifySignatures: 2, persistent: true, autoInit: false, mods: [], modRoots: [],
    rconEnabled: false, rconPort: 2307, rconPassword: '', remoteHost: '', remotePort: 2302, remotePassword: ''
  };
}
function text(value, label, max, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f"\u2028\u2029]/u.test(value)) {
    throw new AppError(`${label}: use up to ${max} characters without double quotes or control characters.`);
  }
  if (!allowEmpty && !value.trim()) throw new AppError(`${label} is required.`);
  return value;
}
export function absolutePath(value, label = 'Path', allowEmpty = false) {
  const result = text(value, label, 1024).trim();
  if (!result && allowEmpty) return '';
  if (!result || result.includes(';') || (!path.isAbsolute(result) && !path.win32.isAbsolute(result))) {
    throw new AppError(`${label}: enter an absolute path without semicolons. Do not include surrounding quotes.`);
  }
  // Reject network/device paths; this launcher is for local, trusted installations.
  if (/^(?:\\\\|\/\/)/.test(result) || /^[a-z]:[^\\/]/i.test(result)) {
    throw new AppError(`${label}: use a local drive path, not a UNC/network/device path.`);
  }
  return result;
}
function executable(value, label, allowed) {
  const result = absolutePath(value, label, true);
  if (result && !allowed.includes(path.win32.basename(result).toLowerCase())) {
    throw new AppError(`${label} must point to ${allowed.join(' or ')}.`);
  }
  return result;
}
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Settings must be a JSON object.');
  const base = defaults();
  for (const key of Object.keys(input)) if (!Object.hasOwn(base, key)) throw new AppError(`Unknown setting: ${key}`);
  const s = { ...base, ...input };
  // Preserve the VPN route in existing 1.2.0 Starlink configurations.
  if (!Object.hasOwn(input, 'starlinkVpn') && input.starlink) s.starlinkVpn = true;
  s.gameExe = executable(s.gameExe, 'Game executable', ['arma3_x64.exe', 'arma3.exe']);
  s.serverExe = executable(s.serverExe, 'Server executable', ['arma3server_x64.exe', 'arma3server.exe']);
  s.serverName = text(s.serverName, 'Server name', 100, false).trim();
  s.password = text(s.password, 'Join password', 64);
  s.adminPassword = text(s.adminPassword, 'Admin password', 64);
  s.remoteHost = text(s.remoteHost, 'Friend server address', 253).trim();
  if (s.remoteHost && !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s.remoteHost)) throw new AppError('Friend server address must be an IPv4 address or hostname, without a port or URL.');
  if (s.remoteHost && /^[\d.]+$/.test(s.remoteHost) && !usableAddress(s.remoteHost) && s.remoteHost !== '127.0.0.1') throw new AppError('Friend server IPv4 address is invalid.');
  if (!Number.isInteger(s.remotePort) || s.remotePort < 1024 || s.remotePort > 65535) throw new AppError('Friend game port must be from 1024 to 65535.');
  s.remotePassword = text(s.remotePassword, 'Friend join password', 64);
  // Config language strings do not have JavaScript escape semantics. Keep user strings literal.
  if (/[\\]/.test(s.password + s.adminPassword + s.serverName)) throw new AppError('Names and passwords cannot contain backslashes.');
  for (const [key, min, max] of [['port', 1024, 65531], ['maxPlayers', 1, 128]]) {
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max) throw new AppError(`${key} must be a whole number from ${min} to ${max}.`);
  }
  for (const key of ['lan', 'battleye', 'persistent', 'autoInit', 'starlink', 'starlinkVpn', 'rconEnabled']) {
    if (typeof s[key] !== 'boolean') throw new AppError(`${key} must be true or false.`);
  }
  if (![0, 2].includes(s.verifySignatures)) throw new AppError('Signature verification must be 0 or 2.');
  if (!['Recruit', 'Regular', 'Veteran'].includes(s.difficulty)) throw new AppError('Select Recruit, Regular or Veteran difficulty.');
  s.mission = text(s.mission, 'Mission template', 180).trim();
  if (s.mission && !/^[A-Za-z0-9_][A-Za-z0-9_ .%+()-]*\.[A-Za-z0-9_]+$/.test(s.mission)) {
    throw new AppError('Mission template must look like MyMission.Altis, without paths or the .pbo extension.');
  }
  if (/\.pbo$/i.test(s.mission)) throw new AppError('Remove the .pbo extension from the mission template.');
  if (s.lan && !s.password.trim()) throw new AppError('LAN mode requires a non-empty join password.');
  s.vpnIp = text(s.vpnIp, 'VPN address', 15).trim();
  if (s.vpnIp && !usableAddress(s.vpnIp)) throw new AppError('VPN address must be a unicast IPv4 address, not localhost or a link-local address.');
  if (s.starlink && s.starlinkVpn && !s.vpnIp) throw new AppError('VPN hosting requires your VPN IPv4 address.');
  if (s.starlink && !s.password.trim()) throw new AppError('Starlink hosting requires a non-empty join password.');
  s.publicIp = text(s.publicIp, 'Public IPv4 address', 15).trim();
  if (s.publicIp && !publicAddress(s.publicIp)) throw new AppError('Enter a public IPv4 address. Private or CGNAT router addresses cannot be used for direct internet sharing.');
  s.rconPassword = text(s.rconPassword, 'RCon password', 64);
  if (s.rconPassword && !/^[\x21-\x7e]+$/.test(s.rconPassword)) throw new AppError('RCon password must use printable ASCII characters without spaces.');
  if (!Number.isInteger(s.rconPort) || s.rconPort < 1024 || s.rconPort > 65535) throw new AppError('RCon port must be a whole number from 1024 to 65535.');
  if (s.rconEnabled) {
    if (!s.battleye) throw new AppError('Live player monitoring requires BattlEye enabled.');
    if (s.rconPassword.length < 12) throw new AppError('RCon password must contain at least 12 characters.');
    if (s.rconPort >= s.port && s.rconPort <= s.port + 4) throw new AppError('RCon port must be outside the five game UDP ports.');
  }
  if (s.autoInit && !s.mission) throw new AppError('Auto-initialise requires a mission template.');
  if (s.autoInit && !s.persistent) throw new AppError('Auto-initialise requires persistent mode.');
  if (!Array.isArray(s.mods) || s.mods.length > 150) throw new AppError('Use at most 150 mod folders.');
  const seen = new Set();
  s.mods = s.mods.map((mod) => {
    if (!mod || typeof mod !== 'object' || !['shared', 'server', 'client'].includes(mod.scope) || typeof mod.enabled !== 'boolean') {
      throw new AppError('Each mod needs a path, an enabled flag, and shared/server/client scope.');
    }
    const p = absolutePath(mod.path, 'Mod folder');
    const key = p.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) throw new AppError(`Duplicate mod folder: ${p}`);
    seen.add(key);
    return { path: p, enabled: mod.enabled, scope: mod.scope };
  });
  if (!Array.isArray(s.modRoots) || s.modRoots.length > 12) throw new AppError('Use at most 12 mod scan roots.');
  s.modRoots = [...new Set(s.modRoots.map(p => absolutePath(p, 'Mod scan root')))];
  return s;
}
export function renderConfig(s, redact = false) {
  const secret = value => redact && value ? '[REDACTED]' : value;
  const lines = [
    '// Generated by Arma 3 Local Host. Original installation configs are not modified.',
    `hostname = "${s.serverName}";`, `password = "${secret(s.password)}";`,
    `passwordAdmin = "${secret(s.adminPassword)}";`, `maxPlayers = ${s.maxPlayers};`,
    `loopback = ${s.lan || s.starlink ? 0 : 1};`, 'upnp = 0;',
    `BattlEye = ${s.battleye ? 1 : 0};`, `verifySignatures = ${s.verifySignatures};`,
    'allowedFilePatching = 0;', 'kickDuplicate = 1;',
    `persistent = ${s.persistent ? 1 : 0};`, 'voteMissionPlayers = 1;',
    'voteThreshold = 0.5;', 'disableVoN = 0;', 'timeStampFormat = "full";',
    'statisticsEnabled = 0;', `forcedDifficulty = "${s.difficulty}";`,
    `autoSelectMission = ${s.mission ? 'true' : 'false'};`, '', 'class Missions', '{'
  ];
  if (s.mission) lines.push('    class LocalMission', '    {', `        template = "${s.mission}";`, `        difficulty = "${s.difficulty}";`, '    };');
  lines.push('};', '');
  return lines.join('\r\n');
}
function modArgs(s, client) {
  const shared = s.mods.filter(m => m.enabled && (m.scope === 'shared' || (client && m.scope === 'client'))).map(m => m.path);
  const server = s.mods.filter(m => m.enabled && m.scope === 'server').map(m => m.path);
  return [...(shared.length ? [`-mod=${shared.join(';')}`] : []), ...(!client && server.length ? [`-serverMod=${server.join(';')}`] : [])];
}
export function renderBattleye(s) {
  return `RConPassword ${s.rconPassword}\r\nRConPort ${s.rconPort}\r\nRConIP 127.0.0.1\r\n`;
}
export function serverArgs(s, { configFile, profilesDir, battleyeDir = path.join(profilesDir, 'BattlEye') }) {
  return [`-config=${configFile}`, `-profiles=${profilesDir}`, '-name=LocalHost', `-port=${s.port}`,
    `-ip=${bindAddress(s)}`, ...(s.rconEnabled ? [`-BEpath=${battleyeDir}`] : []), ...(s.autoInit ? ['-autoInit'] : []), ...modArgs(s, false)];
}
export function clientArgs(s, connection = { host: gameAddress(s), port: s.port, password: s.password }) {
  return ['-noSplash', '-skipIntro', `-connect=${connection.host}`, `-port=${connection.port}`,
    ...(connection.password ? [`-password=${connection.password}`] : []), ...modArgs(s, true)];
}
export function redactArgs(args) { return args.map(a => /^-password=/i.test(a) ? '-password=[REDACTED]' : a); }
export function displayCommand(exe, args) { return [exe || '<configure executable>', ...redactArgs(args)].map(a => `"${a}"`).join(' '); }
