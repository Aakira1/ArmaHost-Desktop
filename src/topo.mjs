import { mkdir, readdir, writeFile, rename, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { TOPO_LIMITS } from './map-addon.mjs';

// Assembles the one-time topographic export written by the server addon (AHTOPO lines in the RPT)
// and caches it per terrain as gzipped JSON. Input is untrusted text: everything is bounded and
// validated, and a terrain is only cached when its end line confirms a complete export.
const ROAD_TYPES = new Set(['MAIN ROAD', 'ROAD', 'TRACK', 'TRAIL']);
const LOCATION_TYPES = new Set(['NameCityCapital', 'NameCity', 'NameVillage', 'NameLocal', 'NameMarine', 'Airport', 'Hill', 'Mount']);
const int = (v, limit) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n) : null; };
const text = v => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 60);
export const worldKey = name => /^[A-Za-z0-9_]{1,64}$/.test(name || '') ? name.toLowerCase() : null;

export class TopoBuilder {
  constructor(dir) { this.dir = dir; this.runs = new Map(); this.progress = new Map(); }
  file(world) { const key = worldKey(world); if (!key) throw new Error('Unknown terrain name.'); return path.join(this.dir, `${key}.json.gz`); }
  async cachedWorlds() { try { return (await readdir(this.dir)).filter(n => n.endsWith('.json.gz')).map(n => n.slice(0, -8)); } catch { return []; } }
  async status(world) {
    const key = worldKey(world); if (!key) return { status: 'none' };
    try { await stat(this.file(world)); return { status: 'ready' }; } catch { /* Not cached. */ }
    const progress = this.progress.get(key);
    return progress ? { status: 'building', progress: progress.value } : { status: 'none' };
  }
  async read(world) { try { return await readFile(this.file(world)); } catch { return null; } }
  // Returns true when the line was a topo line (so callers keep it out of the log).
  ingest(line) {
    const start = typeof line === 'string' ? line.indexOf('AHTOPO|') : -1;
    if (start < 0) return false;
    const parts = line.slice(start, start + 20000).replace(/"\s*$/, '').trimEnd().split('|');
    const [, id, kind] = parts;
    if (!/^\d{1,15}$/.test(id || '')) return true;
    if (kind === 'B') {
      const key = worldKey(parts[3]); const worldSize = int(parts[4], 100000); const n = int(parts[5], TOPO_LIMITS.grid);
      if (!key || !worldSize || worldSize < 100 || !n || n < 8) return true;
      if (this.runs.size > 2) this.runs.clear(); // Abandoned exports (server restarted mid-way) are dropped.
      this.runs.set(id, { key, world: parts[3], worldSize, n, heights: new Array(n), fn: 0, trees: null, roads: [], buildings: [], locations: [] });
      this.progress.set(key, { value: 0 });
      return true;
    }
    const run = this.runs.get(id); if (!run) return true;
    const rows = (count, limit) => { const j = int(parts[3], 1000); const values = (parts[4] || '').split(',').map(v => int(v, limit)); return j !== null && j >= 0 && j < count && values.length === count && values.every(v => v !== null) ? [j, values] : null; };
    const records = () => parts.slice(3).join('|').split('^').map(r => r.split('~'));
    const xy = v => int(v, run.worldSize * 2);
    if (kind === 'H') { const row = rows(run.n, 10000); if (row) run.heights[row[0]] = row[1]; }
    else if (kind === 'G') { const fn = int(parts[3], TOPO_LIMITS.trees); if (fn && fn >= 4) { run.fn = fn; run.trees = new Array(fn); } }
    else if (kind === 'T' && run.trees) { const row = rows(run.fn, 999); if (row) run.trees[row[0]] = row[1]; }
    else if (kind === 'P') { const value = int(parts[3], 100); if (value !== null) this.progress.set(run.key, { value }); }
    else if (kind === 'R') {
      for (const f of records()) {
        if (run.roads.length >= TOPO_LIMITS.roads) break;
        const c = [xy(f[2]), xy(f[3]), xy(f[4]), xy(f[5])]; const width = Number(f[1]);
        if (ROAD_TYPES.has(f[0]) && c.every(v => v !== null) && Number.isFinite(width) && width >= 0 && width < 100) run.roads.push([f[0], Math.round(width * 10) / 10, ...c, f[6] === '1' ? 1 : 0]);
      }
    } else if (kind === 'S') {
      for (const f of records()) {
        if (run.buildings.length >= TOPO_LIMITS.buildings) break;
        const v = [xy(f[0]), xy(f[1]), int(f[2], 360), int(f[3], 200), int(f[4], 200)];
        if (v.every(n => n !== null) && v[3] >= 0 && v[4] >= 0) run.buildings.push(v);
      }
    } else if (kind === 'L') {
      for (const f of records()) {
        if (run.locations.length >= TOPO_LIMITS.locations) break;
        const x = xy(f[2]), y = xy(f[3]);
        if (LOCATION_TYPES.has(f[0]) && x !== null && y !== null) run.locations.push([f[0], text(f[1]), x, y]);
      }
    } else if (kind === 'E') {
      this.runs.delete(id);
      // Count rows explicitly: every() skips the empty slots of a sparse array, so it would accept missing rows.
      const full = rows => rows.filter(Boolean).length === rows.length;
      const complete = full(run.heights) && (!run.trees || full(run.trees)) && int(parts[3], 1000) === run.n;
      if (!complete) { this.progress.delete(run.key); return true; }
      const data = { version: 1, world: run.world, worldSize: run.worldSize, n: run.n, heights: run.heights.flat(), fn: run.fn, trees: run.trees ? run.trees.flat() : [], roads: run.roads, buildings: run.buildings, locations: run.locations };
      this.pending = this.save(run.key, data).catch(() => {}).finally(() => this.progress.delete(run.key));
    }
    return true;
  }
  async save(key, data) {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${key}.json.gz`);
    await writeFile(file + '.tmp', gzipSync(JSON.stringify(data)));
    await rename(file + '.tmp', file);
  }
}
