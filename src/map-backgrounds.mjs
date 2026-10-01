import { mkdir, open, copyFile, unlink, readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { AppError, absolutePath } from './config.mjs';
import { findGameFile } from './arma-files.mjs';
import { decodePaa, encodePng } from './paa.mjs';

// Per-terrain background images for the Live map. Preferred: an image the user chose. Otherwise the
// terrain's own pictureMap, read from the user's installed Arma 3 / server files and converted to PNG
// (cached in data/maps/auto). No Bohemia artwork is bundled with ArmaHost.
const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg' };
export function worldName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(value)) throw new AppError('Unknown terrain name.');
  return value;
}
async function sniff(file) {
  const handle = await open(file, 'r');
  try { const head = Buffer.alloc(8); await handle.read(head, 0, 8, 0); if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'; if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'; return null; }
  finally { await handle.close(); }
}
export class MapBackgrounds {
  constructor(dir) { this.dir = path.join(dir, 'maps'); this.autoDir = path.join(this.dir, 'auto'); this.auto = new Map(); }
  async set(world, source) {
    const name = worldName(world); const file = absolutePath(source, 'Map image');
    let info; try { info = await stat(file); } catch { throw new AppError(`Map image not found: ${file}`); }
    if (!info.isFile()) throw new AppError('Choose an image file, not a folder.');
    if (info.size > MAX_BYTES) throw new AppError('Map image must be 20 MB or smaller.');
    const ext = await sniff(file); if (!ext) throw new AppError('Map image must be a PNG or JPEG file.');
    await mkdir(this.dir, { recursive: true });
    await this.clear(name);
    await copyFile(file, path.join(this.dir, `${name}.${ext}`));
    return { world: name, type: TYPES[ext] };
  }
  async clear(world) { const name = worldName(world); for (const ext of Object.keys(TYPES)) await unlink(path.join(this.dir, `${name}.${ext}`)).catch(() => {}); return { world: name }; }
  async userImage(name) {
    for (const [ext, type] of Object.entries(TYPES)) { try { return { type, data: await readFile(path.join(this.dir, `${name}.${ext}`)), source: 'user' }; } catch { /* try next */ } }
    return null;
  }
  async get(world) {
    const name = worldName(world);
    return await this.userImage(name) ?? await readFile(path.join(this.autoDir, `${name}.png`)).then(data => ({ type: 'image/png', data, source: 'game' }), () => null);
  }
  // Extract the terrain's pictureMap from the installed game/server files once per terrain (cached on disk).
  ensureAuto(world, pictureMap, roots) {
    const name = worldName(world);
    const current = this.auto.get(name);
    if (current && current.pictureMap === pictureMap && (current.status !== 'failed' || Date.now() - current.at < 120000)) return current.promise ?? Promise.resolve(current);
    const entry = { status: 'extracting', pictureMap, at: Date.now(), error: '' };
    this.auto.set(name, entry);
    entry.promise = (async () => {
      const file = path.join(this.autoDir, `${name}.png`);
      try { await stat(file); entry.status = 'ready'; return; } catch { /* Not cached yet. */ }
      const found = await findGameFile(pictureMap, roots);
      if (!found) throw new Error(`Couldn't find ${pictureMap} in your Arma 3 game or server files. The terrain may come from a mod that isn't on this PC.`);
      const png = encodePng(decodePaa(found.data, { maxSize: 2048 }));
      await mkdir(this.autoDir, { recursive: true });
      await writeFile(file + '.tmp', png); await rename(file + '.tmp', file);
      entry.status = 'ready'; entry.from = path.basename(found.pbo);
    })().catch(error => { entry.status = 'failed'; entry.error = error.message; entry.at = Date.now(); })
      .then(() => { delete entry.promise; return entry; });
    return entry.promise;
  }
  async status(world) {
    const name = worldName(world);
    if (await this.userImage(name)) return { source: 'user', status: 'ready' };
    const auto = this.auto.get(name);
    if (auto) return { source: 'game', status: auto.status, error: auto.error, from: auto.from };
    try { await stat(path.join(this.autoDir, `${name}.png`)); return { source: 'game', status: 'ready' }; } catch { return { source: null, status: 'none' }; }
  }
}
