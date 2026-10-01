import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

// Finds and reads a file by its in-game path (e.g. "A3\map_Altis\data\pictureMap_ca.paa") inside the
// PBO archives of the user's own Arma 3 installation. Only PBO headers are read while searching.
const norm = p => String(p).replaceAll('/', '\\').replace(/^\\+/, '').toLowerCase();

async function readHeader(file, maxHeader = 64 * 1024 * 1024) {
  const handle = await open(file, 'r');
  try {
    let size = 64 * 1024, buffer;
    for (;;) {
      buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      buffer = buffer.subarray(0, bytesRead);
      const parsed = parseHeader(buffer);
      if (parsed) return parsed;
      if (bytesRead < size || size >= maxHeader) throw new Error(`Unreadable PBO header: ${path.basename(file)}`);
      size *= 4;
    }
  } finally { await handle.close(); }
}
// Returns null when the buffer ends before the header does (caller reads more).
export function parseHeader(buffer) {
  let at = 0;
  const zs = () => { const end = buffer.indexOf(0, at); if (end < 0) return null; const s = buffer.toString('latin1', at, end); at = end + 1; return s; };
  const entry = () => { const name = zs(); if (name === null || at + 20 > buffer.length) return null; const e = { name, method: buffer.readUInt32LE(at), size: buffer.readUInt32LE(at + 16) }; at += 20; return e; };
  const first = entry(); if (!first) return null;
  const extensions = {};
  if (first.method === 0x56657273) {
    for (;;) { const key = zs(); if (key === null) return null; if (!key) break; const value = zs(); if (value === null) return null; extensions[key.toLowerCase()] = value; }
  } else at = 0; // No version entry: the first record is a file.
  const files = []; let offset = 0;
  for (;;) {
    const e = entry(); if (!e) return null;
    if (!e.name) break;
    files.push({ name: e.name, method: e.method, size: e.size, offset }); offset += e.size;
  }
  return { prefix: norm(extensions.prefix || ''), files, dataStart: at };
}

// Folders that hold PBOs: <root>/Addons, <root>/<DLC>/Addons, and mod folders' addons.
export async function addonFolders(roots) {
  const folders = new Set();
  for (const root of roots.filter(Boolean)) {
    for (const name of ['Addons', 'addons']) folders.add(path.join(root, name));
    let entries = []; try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('!')) for (const name of ['Addons', 'addons']) folders.add(path.join(root, entry.name, name));
  }
  return [...folders];
}
export async function findGameFile(virtualPath, roots) {
  const wanted = norm(virtualPath);
  if (!/^[a-z0-9_\\. -]+$/.test(wanted) || wanted.includes('..')) throw new Error('Invalid in-game file path.');
  const seen = new Set();
  for (const folder of await addonFolders(roots)) {
    let names = []; try { names = (await readdir(folder)).filter(n => /\.pbo$/i.test(n)); } catch { continue; }
    for (const name of names) {
      const file = path.join(folder, name); const key = file.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      let header; try { header = await readHeader(file); } catch { continue; }
      if (!header.prefix || !wanted.startsWith(header.prefix + '\\')) continue;
      const inner = wanted.slice(header.prefix.length + 1);
      const match = header.files.find(f => norm(f.name) === inner);
      if (!match) continue;
      if (match.method !== 0) throw new Error(`${virtualPath} is stored compressed in ${name}, which is not supported.`);
      if (match.size > 128 * 1024 * 1024) throw new Error(`${virtualPath} is unexpectedly large.`);
      const handle = await open(file, 'r');
      try { const data = Buffer.alloc(match.size); await handle.read(data, 0, match.size, header.dataStart + match.offset); return { data, pbo: file }; }
      finally { await handle.close(); }
    }
  }
  return null;
}
