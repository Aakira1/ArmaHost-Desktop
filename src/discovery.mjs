import { readdir, readFile, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { absolutePath } from './config.mjs';

const execute = promisify(execFile);
export async function isFile(file) { try { return Boolean(file && (await stat(file)).isFile()); } catch { return false; } }
export async function isDirectory(dir) { try { return Boolean(dir && (await stat(dir)).isDirectory()); } catch { return false; } }
export function parseLibraryPaths(text) {
  return [...text.matchAll(/"path"\s*"([^"\r\n]+)"/g)].map(m => m[1].replaceAll('\\\\', '\\'));
}
export async function discoverInstallations() {
  const libraries = new Set(); const games = new Set(); const servers = new Set(); const modRoots = new Set(); const notes = [];
  const roots = new Set();
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) if (base) roots.add(path.join(base, 'Steam'));
    const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    try {
      const { stdout } = await execute(reg, ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 3000, maxBuffer: 16384 });
      const found = stdout.match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/i); if (found) roots.add(found[1].trim());
    } catch { notes.push('Steam registry lookup unavailable; scanning standard locations.'); }
  } else notes.push('Automatic Windows installation discovery is unavailable on this OS. Demo mode still works.');
  for (const steam of roots) {
    if (!(await isDirectory(steam))) continue;
    libraries.add(steam);
    try { for (const p of parseLibraryPaths(await readFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8'))) libraries.add(p); } catch { /* Manual paths remain available. */ }
  }
  for (const library of [...libraries].slice(0, 30)) {
    const apps = path.join(library, 'steamapps');
    for (const [id, defaultName, kind] of [['107410', 'Arma 3', 'game'], ['233780', 'Arma 3 Server', 'server']]) {
      let installName = defaultName;
      try {
        const manifest = await readFile(path.join(apps, `appmanifest_${id}.acf`), 'utf8');
        installName = manifest.match(/"installdir"\s+"([^"\r\n]+)"/i)?.[1] || defaultName;
      } catch { /* Search the default directory too. */ }
      if (/[\\/]/.test(installName) || installName.includes('..')) continue;
      const folder = path.join(apps, 'common', installName);
      for (const exe of kind === 'game' ? ['arma3_x64.exe', 'arma3.exe'] : ['arma3server_x64.exe', 'arma3server.exe']) {
        const p = path.join(folder, exe); if (await isFile(p)) (kind === 'game' ? games : servers).add(p);
      }
      if (kind === 'game') {
        for (const exe of ['arma3server_x64.exe', 'arma3server.exe']) if (await isFile(path.join(folder, exe))) servers.add(path.join(folder, exe));
        if (await isDirectory(path.join(folder, '!Workshop'))) modRoots.add(path.join(folder, '!Workshop'));
      }
    }
    const workshop = path.join(apps, 'workshop', 'content', '107410');
    if (await isDirectory(workshop)) modRoots.add(workshop);
  }
  return { games: [...games], servers: [...servers], modRoots: [...modRoots], notes };
}
export async function scanMissions(serverExe) {
  const missions = []; const warnings = [];
  if (!serverExe) return { missions, folder: '', warnings: ['Set and save the server executable first.'] };
  const folder = path.join(path.dirname(serverExe), 'MPMissions');
  try {
    const items = await readdir(folder, { withFileTypes: true });
    for (const item of items.slice(0, 1000)) {
      const file = path.join(folder, item.name);
      let template;
      if (item.isFile() && /\.pbo$/i.test(item.name)) template = item.name.replace(/\.pbo$/i, '');
      if (item.isDirectory() && await isFile(path.join(file, 'mission.sqm'))) template = item.name;
      if (template && /^[A-Za-z0-9_][A-Za-z0-9_ .%+()-]*\.[A-Za-z0-9_]+$/.test(template)) missions.push({ template, file });
    }
    if (items.length > 1000) warnings.push('Scan limited to the first 1,000 entries. Enter unlisted mission templates manually.');
  } catch (error) { warnings.push(error.code === 'ENOENT' ? 'No MPMissions folder found. Add your mission to the server installation or enter a built-in mission template.' : `Cannot read MPMissions: ${error.message}`); }
  return { folder, missions: missions.sort((a, b) => a.template.localeCompare(b.template)), warnings };
}
async function modName(folder) {
  for (const name of ['mod.cpp', 'meta.cpp']) {
    try {
      const file = path.join(folder, name);
      if ((await stat(file)).size > 65536) continue;
      const text = await readFile(file, 'utf8');
      const match = text.match(/\bname\s*=\s*"([^"\r\n]{1,160})"/i);
      if (match) return match[1];
    } catch { /* A missing metadata file does not make a mod invalid. */ }
  }
  return path.basename(folder);
}
export async function scanMods(roots) {
  const mods = []; const warnings = []; const seen = new Set();
  for (const raw of roots.slice(0, 12)) {
    const root = absolutePath(raw, 'Mod scan root');
    try {
      const items = await readdir(root, { withFileTypes: true });
      for (const entry of items.slice(0, 500)) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const folder = path.join(root, entry.name);
        if (!(await isDirectory(path.join(folder, 'addons'))) && !(await isDirectory(path.join(folder, 'Addons')))) continue;
        // Steam !Workshop uses junctions; resolve duplicates without descending recursively.
        const { realpath } = await import('node:fs/promises');
        const real = (await realpath(folder)).toLowerCase();
        if (seen.has(real)) continue;
        seen.add(real); mods.push({ path: folder, name: await modName(folder) });
      }
      if (items.length > 500) warnings.push(`${root}: first 500 entries scanned.`);
    } catch (error) { warnings.push(`${root}: ${error.message}`); }
  }
  return { mods: mods.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}
export async function diagnostics(s, dir, demo) {
  const checks = [];
  const add = (name, ok, detail, warning = false) => checks.push({ name, ok, detail, warning });
  add('Operating system', demo || process.platform === 'win32', demo ? 'Demo mode; real Arma launching is disabled.' : `${os.type()} ${os.release()} — live launch requires Windows.`);
  add('Server executable', await isFile(s.serverExe), s.serverExe || 'Choose arma3server_x64.exe in Setup.', demo);
  add('Game executable', await isFile(s.gameExe), s.gameExe || 'Choose arma3_x64.exe in Setup.', demo);
  try { await access(dir, constants.W_OK); add('Application data', true, dir); } catch { add('Application data', false, `Not writable: ${dir}`); }
  for (const m of s.mods.filter(m => m.enabled)) add(`Mod: ${path.basename(m.path)}`, await isDirectory(m.path), m.path);
  if (s.mods.some(m => m.enabled) && s.verifySignatures) add('Mod signing keys', false, 'Copy the trusted mods’ .bikey files into the server keys folder. This app does not install keys or resolve dependencies.', true);
  if (s.battleye) add('BattlEye client', false, 'Join launches the game executable directly. If BattlEye asks to restart, use the official Arma launcher with BattlEye enabled and Direct Connect to the shown address.', true);
  if (s.lan) add('LAN access', false, 'Game sockets can accept network traffic. Configure Windows Firewall deliberately. Management remains localhost-only; no ports are opened automatically.', true);
  if (s.starlink && s.starlinkVpn) {
    const { hostingInfo } = await import('./network.mjs');
    const info = hostingInfo(s);
    add('Starlink VPN address', info.assigned, info.assigned ? `VPN bind address ${info.address} is present on this PC. Peer access is not verified.` : 'Connect your VPN and detect its address again.', demo);
    add('Starlink peer access', false, 'Friends need Tailscale access to this PC and matching mods. Allow game UDP traffic through Windows Firewall and your VPN access policy.', true);
  }
  if ((s.lan || s.starlink) && !(s.starlink && s.starlinkVpn)) add(s.starlink ? 'Starlink direct hosting' : 'Normal network hosting', false, `Game UDP ${s.port}-${s.port + 4}. Forward these ports to this PC for internet play and allow the server through Windows Firewall. Public IPv4 ${s.publicIp || 'not supplied'}; external access is unverified.`, true);
  if (s.rconEnabled) add('Live player monitoring', s.battleye, `BattlEye RCon uses localhost UDP ${s.rconPort}. Save and restart to apply settings; use Overview to check its response.`, true);
  return { checks, canStart: demo || (process.platform === 'win32' && await isFile(s.serverExe)) };
}
