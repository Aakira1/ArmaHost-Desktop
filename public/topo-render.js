// Draws an Arma-style topographic map (sea, relief, contours, forests, roads, buildings, names) from
// the terrain data exported by the server. Pure helpers are exported for tests.

// Marching squares: line segments where the height grid crosses `level`.
// heights: flat n*n array, row j = world y (south to north), column i = world x. Returns segments in
// grid coordinates (cell centres at integer positions).
export function contourSegments(heights, n, level) {
  const out = [];
  const h = (i, j) => heights[j * n + i];
  const lerp = (a, b) => (level - a) / (b - a);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = h(i, j), b = h(i + 1, j), c = h(i + 1, j + 1), d = h(i, j + 1);
    const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const bottom = [i + lerp(a, b), j], right = [i + 1, j + lerp(b, c)], top = [i + lerp(d, c), j + 1], left = [i, j + lerp(a, d)];
    const pairs = { 1: [left, bottom], 2: [bottom, right], 3: [left, right], 4: [right, top], 5: [left, top, bottom, right], 6: [bottom, top], 7: [left, top],
      8: [top, left], 9: [top, bottom], 10: [bottom, left, top, right], 11: [top, right], 12: [right, left], 13: [right, bottom], 14: [bottom, left] }[code];
    for (let k = 0; k < pairs.length; k += 2) out.push([pairs[k][0], pairs[k][1], pairs[k + 1][0], pairs[k + 1][1]]);
  }
  return out;
}
export function contourLevels(min, max, worldSize) {
  const minor = worldSize > 15000 ? 20 : 10;
  const levels = [];
  for (let v = Math.ceil(Math.max(min, 1) / minor) * minor; v <= max && levels.length < 200; v += minor) levels.push({ value: v, major: v % (minor * 5) === 0 });
  return levels;
}
// Bilinear height lookup at world position.
export function heightAt(data, x, y) {
  const cell = data.worldSize / data.n;
  const gx = Math.max(0, Math.min(data.n - 1.001, x / cell - 0.5)), gy = Math.max(0, Math.min(data.n - 1.001, y / cell - 0.5));
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, n = data.n, h = data.heights;
  const a = h[j * n + i], b = h[j * n + Math.min(i + 1, n - 1)], c = h[Math.min(j + 1, n - 1) * n + i], d = h[Math.min(j + 1, n - 1) * n + Math.min(i + 1, n - 1)];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

const ROAD_STYLE = { 'MAIN ROAD': ['#e89c3f', 3.2, []], ROAD: ['#f2cf62', 2.2, []], TRACK: ['#9a7a55', 1.4, []], TRAIL: ['#9a7a55', 1, [4, 3]] };
const LABEL_STYLE = { NameCityCapital: ['bold 22px', '#1d1d1d'], NameCity: ['bold 17px', '#1d1d1d'], NameVillage: ['14px', '#262626'], NameLocal: ['italic 12px', '#3a3a3a'], NameMarine: ['italic 13px', '#2a5c8f'], Airport: ['bold 12px', '#5a2a7a'], Hill: ['11px', '#6b4b2b'], Mount: ['11px', '#6b4b2b'] };

// Smoothly interpolated tree count around a world position (avoids a blocky forest layer).
export function treeDensity(data, fcell, x, y) {
  const n = data.fn, gx = Math.max(0, Math.min(n - 1.001, x / fcell - 0.5)), gy = Math.max(0, Math.min(n - 1.001, y / fcell - 0.5));
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, t = data.trees;
  const i2 = Math.min(i + 1, n - 1), j2 = Math.min(j + 1, n - 1);
  return (t[j * n + i] * (1 - fx) + t[j * n + i2] * fx) * (1 - fy) + (t[j2 * n + i] * (1 - fx) + t[j2 * n + i2] * fx) * fy;
}
export function renderTopo(canvas, data) {
  const size = data.worldSize >= 10000 ? 3072 : 2048;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const k = size / data.worldSize; // px per metre
  const px = x => x * k, py = y => size - y * k; // north up
  // Relief: sea depth tint, land with gentle hillshade, forest tint.
  const img = ctx.createImageData(size, size);
  const fcell = data.fn ? data.worldSize / data.fn : 0;
  for (let r = 0; r < size; r++) {
    const wy = (size - r - 0.5) / k;
    for (let c = 0; c < size; c++) {
      const wx = (c + 0.5) / k;
      const hgt = heightAt(data, wx, wy);
      let R, G, B;
      if (hgt <= 0) { const d = Math.min(1, -hgt / 60); R = 172 - 70 * d; G = 204 - 54 * d; B = 230 - 30 * d; }
      else {
        const e = 6 / k; const dx = heightAt(data, wx + e, wy) - heightAt(data, wx - e, wy), dy = heightAt(data, wx, wy + e) - heightAt(data, wx, wy - e);
        const shade = Math.max(0.78, Math.min(1.06, 1 + (dy - dx) / (4 * e) * 0.9));
        R = 236 * shade; G = 231 * shade; B = 214 * shade;
        if (fcell) {
          const t = Math.min(0.75, treeDensity(data, fcell, wx, wy) / 35);
          R = R * (1 - t) + 158 * t; G = G * (1 - t) + 192 * t; B = B * (1 - t) + 128 * t;
        }
      }
      const o = (r * size + c) * 4; img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Contours (brown, every 5th bold) and the coastline.
  const cell = data.worldSize / data.n;
  const gx = g => px((g + 0.5) * cell), gy = g => py((g + 0.5) * cell);
  let min = Infinity, max = -Infinity; for (const v of data.heights) { if (v < min) min = v; if (v > max) max = v; }
  const stroke = (segments, style, width) => { ctx.beginPath(); for (const s of segments) { ctx.moveTo(gx(s[0]), gy(s[1])); ctx.lineTo(gx(s[2]), gy(s[3])); } ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke(); };
  for (const level of contourLevels(min, max, data.worldSize)) stroke(contourSegments(data.heights, data.n, level.value), level.major ? 'rgba(140,96,52,0.75)' : 'rgba(150,110,70,0.38)', level.major ? 1.2 : 0.7);
  stroke(contourSegments(data.heights, data.n, 0), 'rgba(60,110,160,0.9)', 1.4);
  // Roads, minor first so main roads draw on top.
  ctx.lineCap = 'round';
  for (const type of ['TRAIL', 'TRACK', 'ROAD', 'MAIN ROAD']) {
    const [color, width, dash] = ROAD_STYLE[type];
    ctx.beginPath(); ctx.setLineDash(dash);
    for (const r of data.roads) if (r[0] === type) { ctx.moveTo(px(r[2]), py(r[3])); ctx.lineTo(px(r[4]), py(r[5])); }
    if (type === 'MAIN ROAD' || type === 'ROAD') { ctx.strokeStyle = 'rgba(90,70,40,0.55)'; ctx.lineWidth = width + 1.4; ctx.stroke(); }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  ctx.setLineDash([]);
  // Buildings as small rotated rectangles.
  ctx.fillStyle = 'rgba(70,70,70,0.85)';
  for (const [x, y, dir, w, l] of data.buildings) {
    const cx = px(x), cy = py(y), hw = Math.max(0.7, w * k / 2), hl = Math.max(0.7, l * k / 2);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(dir * Math.PI / 180); ctx.fillRect(-hw, -hl, hw * 2, hl * 2); ctx.restore();
  }
  // Place names with a light halo; hills/mounts get a small marker.
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const order = ['Hill', 'Mount', 'NameLocal', 'NameMarine', 'Airport', 'NameVillage', 'NameCity', 'NameCityCapital'];
  for (const type of order) for (const [t, name, x, y] of data.locations) {
    if (t !== type) continue;
    const [font, color] = LABEL_STYLE[type];
    if (type === 'Hill' || type === 'Mount') { ctx.fillStyle = '#6b4b2b'; ctx.beginPath(); ctx.moveTo(px(x), py(y) - 4); ctx.lineTo(px(x) + 4, py(y) + 3); ctx.lineTo(px(x) - 4, py(y) + 3); ctx.fill(); if (!name) continue; }
    if (!name) continue;
    ctx.font = `${font} "Segoe UI", Arial, sans-serif`;
    const yOffset = type === 'Hill' || type === 'Mount' ? 12 : 0;
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText(name, px(x), py(y) + yOffset);
    ctx.fillStyle = color; ctx.fillText(name, px(x), py(y) + yOffset);
  }
  return canvas;
}
