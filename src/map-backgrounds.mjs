import { mkdir, open, copyFile, unlink, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, absolutePath } from './config.mjs';

// Per-terrain background images for the Live map, supplied by the user (Bohemia terrain art is not bundled).
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
  constructor(dir) { this.dir = path.join(dir, 'maps'); }
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
  async get(world) {
    const name = worldName(world);
    for (const [ext, type] of Object.entries(TYPES)) { try { return { type, data: await readFile(path.join(this.dir, `${name}.${ext}`)) }; } catch { /* try next */ } }
    return null;
  }
}
