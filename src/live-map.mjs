import { LIMITS } from './map-addon.mjs';

// Assembles AHMAP frames written by the server-only map addon. Input is untrusted text from the RPT:
// every field is bounded and parsed as data; a frame is only published when its end line confirms
// the expected record counts.
const SIDES = new Set(['WEST', 'EAST', 'GUER', 'CIV', 'LOGIC', 'ENEMY', 'UNKNOWN', 'EMPTY', 'AMBIENT LIFE']);
const text = (value, max = 120) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, max);
const num = (value, limit = 1e6) => { const n = Number(value); return Number.isFinite(n) && Math.abs(n) <= limit ? n : null; };
const side = value => SIDES.has(value) ? value : 'UNKNOWN';
const PARSERS = {
  U: f => { const x = num(f[2]), y = num(f[3]); return x === null || y === null ? null : { name: text(f[0], 60), side: side(f[1]), x, y, dir: num(f[4], 360) ?? 0, player: f[5] === '1', vehicle: text(f[6], 60), group: text(f[7], 60) }; },
  V: f => { const x = num(f[2]), y = num(f[3]); return x === null || y === null ? null : { name: text(f[0], 60), side: side(f[1]), x, y, dir: num(f[4], 360) ?? 0, crew: Math.max(0, Math.min(99, num(f[5], 99) ?? 0)), alive: f[6] !== '0', type: text(f[7], 80) }; },
  M: f => { const x = num(f[5]), y = num(f[6]); return x === null || y === null ? null : { name: text(f[0], 60), text: text(f[1], 60), type: text(f[2], 60), color: text(f[3], 40), shape: ['ICON', 'RECTANGLE', 'ELLIPSE'].includes(f[4]) ? f[4] : 'ICON', x, y, w: Math.abs(num(f[7], 1e5) ?? 1), h: Math.abs(num(f[8], 1e5) ?? 1), dir: num(f[9], 360) ?? 0, alpha: Math.max(0, Math.min(1, num(f[10], 1) ?? 1)) }; }
};
const KEYS = { U: 'units', V: 'vehicles', M: 'markers' };

export class LiveMap {
  constructor(now = () => Date.now()) { this.now = now; this.reset(); }
  reset() { this.pending = null; this.frame = null; this.receivedAt = 0; this.frames = 0; }
  // Returns true when the line was a map line (consumed), so callers can keep it out of the log.
  ingest(line) {
    const start = typeof line === 'string' ? line.indexOf('AHMAP|') : -1;
    if (start < 0) return false;
    const parts = line.slice(start, start + 20000).replace(/"\s*$/, '').trimEnd().split('|');
    const [, kind, seq] = parts;
    if (kind === 'F') {
      const size = num(parts[5], 1e6);
      this.pending = size && size > 0 ? { seq, time: num(parts[3]) ?? 0, world: text(parts[4], 64).replace(/[^A-Za-z0-9_]/g, '') || 'Unknown', worldSize: size, interval: Math.max(1, Math.min(60, num(parts[6], 60) ?? 3)), pictureMap: /^\\?[A-Za-z0-9_][A-Za-z0-9_\\. -]{0,200}\.paa$/i.test(parts[7] || '') && !parts[7].includes('..') ? parts[7] : '', units: [], vehicles: [], markers: [] } : null;
    } else if (PARSERS[kind]) {
      const frame = this.pending; if (!frame || frame.seq !== seq) return true;
      const list = frame[KEYS[kind]];
      for (const record of parts.slice(3).join('|').split('^')) {
        if (list.length >= LIMITS[KEYS[kind]]) break;
        const item = PARSERS[kind](record.split('~')); if (item) list.push(item);
      }
    } else if (kind === 'E') {
      const frame = this.pending; this.pending = null;
      if (!frame || frame.seq !== seq) return true;
      const expected = parts.slice(3, 6).map(Number);
      // Records that failed validation are dropped, so a frame may only be smaller than announced.
      if (frame.units.length <= expected[0] && frame.vehicles.length <= expected[1] && frame.markers.length <= expected[2]) {
        this.frame = frame; this.receivedAt = this.now(); this.frames++;
      }
    }
    return true;
  }
  snapshot({ running, enabled, demo = false }) {
    const age = this.frame ? this.now() - this.receivedAt : null;
    let status;
    if (!running) status = 'stopped';
    else if (!enabled && !demo) status = 'disabled';
    else if (!this.frame) status = 'waiting';
    else status = age > (this.frame.interval * 3 + 2) * 1000 ? 'stale' : 'live';
    return { status, demo, ageMs: age, frame: running ? this.frame : null };
  }
}
