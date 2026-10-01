// Live map page: renders AHMAP frames from /api/map as SVG on a grid scaled to the terrain.
import { renderTopo } from './topo-render.js';
const NS = 'http://www.w3.org/2000/svg';
const SIDE_COLORS = { WEST: '#5b9bff', EAST: '#ff6b6b', GUER: '#46c35b', CIV: '#c79bff' };
const SIDE_NAMES = { WEST: 'BLUFOR', EAST: 'OPFOR', GUER: 'Independent', CIV: 'Civilian' };
const MARKER_COLORS = { ColorBLUFOR: '#5b9bff', ColorWEST: '#5b9bff', ColorOPFOR: '#ff6b6b', ColorEAST: '#ff6b6b', ColorIndependent: '#46c35b', ColorGUER: '#46c35b', ColorCivilian: '#c79bff', ColorCIV: '#c79bff',
  ColorRed: '#e05252', ColorGreen: '#4caf50', ColorBlue: '#4a7fe0', ColorYellow: '#e8d44d', ColorOrange: '#f09a3e', ColorWhite: '#f2f2f2', ColorBlack: '#222', ColorGrey: '#999', ColorBrown: '#8d6748', ColorPink: '#f48fb1', ColorKhaki: '#b8a56a', ColorUNKNOWN: '#bbb' };
const STATUS = { stopped: 'SERVER STOPPED', disabled: 'LIVE MAP OFF', waiting: 'WAITING FOR DATA', live: 'LIVE', stale: 'STALE' };
const el = (name, attrs = {}, parent) => { const node = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); parent?.append(node); return node; };
const grid = (x, y) => `${String(Math.floor(x / 100)).padStart(3, '0')} ${String(Math.floor(y / 100)).padStart(3, '0')}`;

export function initMap({ api, apiBlob, notify, isVisible }) {
  const $ = id => document.getElementById(id);
  const svg = $('map-svg'), tooltip = $('map-tooltip');
  let snapshot = null, world = null, size = 0, view = null, background = null, timer = null, drag = null, backgroundKey = '';
  const topoImages = new Map(); // world -> object URL of the drawn topographic map
  let base = 'topo'; try { base = localStorage.getItem('arma-map-base') || 'topo'; } catch { /* Storage unavailable. */ }
  $('map-base').value = base;
  $('map-base').addEventListener('change', () => { base = $('map-base').value; try { localStorage.setItem('arma-map-base', base); } catch { /* Not persisted. */ } backgroundKey = ''; void refresh(); });
  async function topoImage(name) {
    if (topoImages.has(name)) return topoImages.get(name);
    const blob = await apiBlob(`/api/map/topo?world=${encodeURIComponent(name)}`);
    if (!blob) return null;
    const data = JSON.parse(await blob.text());
    $('map-bg-note').textContent = `Drawing the ${name} topographic map…`;
    await new Promise(resolve => setTimeout(resolve, 30)); // let the note paint before the heavy draw
    const canvas = renderTopo(document.createElement('canvas'), data);
    const url = URL.createObjectURL(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    topoImages.set(name, url);
    return url;
  }
  const shown = () => ({ ai: $('map-ai').checked, vehicles: $('map-vehicles').checked, markers: $('map-markers').checked, labels: $('map-labels').checked });

  function setView(next) {
    const w = Math.max(size / 64, Math.min(size * 1.5, next.w));
    view = { x: Math.max(-size * 0.25, Math.min(size * 1.25 - w, next.x)), y: Math.max(-size * 0.25, Math.min(size * 1.25 - w, next.y)), w };
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.w}`);
    render();
  }
  const resetView = () => size && setView({ x: 0, y: 0, w: size });
  const pxScale = () => view.w / Math.max(1, svg.clientWidth || 600); // world units per screen pixel
  const toSvg = (x, y) => [x, size - y]; // Arma Y points north; SVG Y points down

  async function loadBackground(name) {
    if (background?.url && !background.cached) URL.revokeObjectURL(background.url);
    background = null;
    if (base === 'grid') { render(); return; }
    if (base === 'topo' && snapshot?.topo?.status === 'ready') {
      try { const url = await topoImage(name); if (url) background = { url, cached: true, kind: 'topo' }; } catch (error) { console.warn('Topographic map failed', error); }
    }
    if (!background) {
      try { const blob = await apiBlob(`/api/map/background?world=${encodeURIComponent(name)}`); if (blob) background = { url: URL.createObjectURL(blob), kind: 'image' }; } catch { /* No image saved: grid only. */ }
    }
    $('map-image-clear').hidden = snapshot?.background?.source !== 'user';
    render();
  }

  function render() {
    svg.replaceChildren();
    const frame = snapshot?.frame;
    $('map-empty').hidden = Boolean(frame);
    if (!frame || !view) return;
    const k = pxScale(), show = shown();
    el('rect', { x: 0, y: 0, width: size, height: size, class: 'map-world' }, svg);
    if (background) el('image', { href: background.url, x: 0, y: 0, width: size, height: size, preserveAspectRatio: 'none', opacity: background.kind === 'topo' ? 1 : 0.85 }, svg);
    // Grid: aim for roughly 6-14 lines across the view.
    const step = [100, 200, 500, 1000, 2000, 5000].find(s => view.w / s <= 14) || 10000;
    const lines = el('g', { class: 'map-grid', 'stroke-width': k }, svg);
    for (let v = 0; v <= size; v += step) { el('line', { x1: v, y1: 0, x2: v, y2: size }, lines); el('line', { x1: 0, y1: v, x2: size, y2: v }, lines); }
    const labels = el('g', { class: 'map-grid-label', 'font-size': 10 * k }, svg);
    for (let v = step; v < size; v += step) {
      el('text', { x: v + 3 * k, y: view.y + 12 * k }, labels).textContent = String(Math.floor(v / 100)).padStart(3, '0');
      el('text', { x: view.x + 3 * k, y: size - v - 3 * k }, labels).textContent = String(Math.floor(v / 100)).padStart(3, '0');
    }
    const tip = (node, lines) => { node.addEventListener('pointerenter', () => { tooltip.textContent = lines.filter(Boolean).join('\n'); tooltip.hidden = false; }); node.addEventListener('pointerleave', () => { tooltip.hidden = true; }); };
    if (show.markers) {
      const g = el('g', { class: 'map-markers' }, svg);
      for (const m of frame.markers) {
        const [x, y] = toSvg(m.x, m.y), color = MARKER_COLORS[m.color] || '#e3b341';
        if (m.shape === 'ICON') {
          const node = el('path', { d: `M${x} ${y - 6 * k}L${x + 5 * k} ${y}L${x} ${y + 6 * k}L${x - 5 * k} ${y}Z`, fill: color, stroke: '#000', 'stroke-width': k, opacity: m.alpha }, g);
          tip(node, [m.text || m.name, `Marker · ${m.type}`, `Grid ${grid(m.x, m.y)}`]);
          if (m.text) el('text', { x: x + 8 * k, y: y + 4 * k, 'font-size': 11 * k, fill: color, class: 'map-label' }, g).textContent = m.text;
        } else {
          const attrs = { fill: color, 'fill-opacity': 0.25 * m.alpha, stroke: color, 'stroke-width': 1.5 * k, transform: `rotate(${m.dir} ${x} ${y})` };
          const node = m.shape === 'ELLIPSE' ? el('ellipse', { cx: x, cy: y, rx: m.w, ry: m.h, ...attrs }, g) : el('rect', { x: x - m.w, y: y - m.h, width: m.w * 2, height: m.h * 2, ...attrs }, g);
          tip(node, [m.text || m.name, `Area · ${m.shape.toLowerCase()}`, `Grid ${grid(m.x, m.y)}`]);
          if (m.text) el('text', { x, y, 'font-size': 11 * k, fill: color, 'text-anchor': 'middle', class: 'map-label' }, g).textContent = m.text;
        }
      }
    }
    if (show.vehicles) {
      const g = el('g', { class: 'map-vehicles' }, svg);
      for (const v of frame.vehicles) {
        const [x, y] = toSvg(v.x, v.y), s = 5 * k, color = SIDE_COLORS[v.side] || '#bbb';
        const node = el('rect', { x: x - s, y: y - s, width: s * 2, height: s * 2, fill: v.alive ? color : 'none', 'fill-opacity': v.crew ? 0.9 : 0.35, stroke: v.alive ? '#000' : color, 'stroke-width': k, transform: `rotate(${v.dir} ${x} ${y})` }, g);
        tip(node, [v.name || v.type, `${v.alive ? (v.crew ? `${v.crew} crew` : 'Empty') : 'Destroyed'} · ${SIDE_NAMES[v.side] || v.side}`, `Grid ${grid(v.x, v.y)}`]);
      }
    }
    const g = el('g', { class: 'map-units' }, svg);
    const units = frame.units.filter(u => u.player || show.ai).sort((a, b) => a.player - b.player);
    for (const u of units) {
      const [x, y] = toSvg(u.x, u.y), r = (u.player ? 5.5 : 3.5) * k, color = SIDE_COLORS[u.side] || '#bbb', rad = u.dir * Math.PI / 180;
      el('line', { x1: x, y1: y, x2: x + Math.sin(rad) * r * 2.4, y2: y - Math.cos(rad) * r * 2.4, stroke: color, 'stroke-width': 1.5 * k }, g);
      const node = el('circle', { cx: x, cy: y, r, fill: color, stroke: u.player ? '#fff' : '#000', 'stroke-width': (u.player ? 1.5 : 1) * k }, g);
      tip(node, [u.name, `${u.player ? 'Player' : 'AI'} · ${SIDE_NAMES[u.side] || u.side}${u.group ? ` · ${u.group}` : ''}`, u.vehicle ? `In ${u.vehicle}` : '', `Grid ${grid(u.x, u.y)}`]);
      if (u.player || show.labels) el('text', { x: x + r + 3 * k, y: y + 4 * k, 'font-size': (u.player ? 12 : 10) * k, fill: '#fff', class: 'map-label' }, g).textContent = u.name;
    }
  }

  function summary() {
    const s = snapshot; const frame = s?.frame;
    $('map-status').textContent = (s?.demo ? 'DEMO · ' : '') + (STATUS[s?.status] || 'NOT CHECKED');
    $('map-status').classList.toggle('running', s?.status === 'live');
    $('map-status').classList.toggle('failed', s?.status === 'stale');
    $('map-world').textContent = frame ? `${frame.world} · ${(frame.worldSize / 1000).toFixed(1)} km` : '—';
    $('map-updated').textContent = frame ? `Updated ${Math.round(s.ageMs / 1000)} s ago · every ${frame.interval} s` : '';
    const counts = {}; for (const u of frame?.units || []) counts[u.side] = (counts[u.side] || 0) + 1;
    const players = (frame?.units || []).filter(u => u.player).length;
    $('map-counts').replaceChildren(...(frame ? [[`${players}`, 'players'], ...Object.entries(counts).map(([side, n]) => [String(n), SIDE_NAMES[side] || side]), [String(frame.vehicles.length), 'vehicles'], [String(frame.markers.length), 'markers']] : []).map(([n, label]) => {
      const chip = document.createElement('span'); chip.className = 'map-chip'; const b = document.createElement('strong'); b.textContent = n; chip.append(b, ` ${label}`); return chip;
    }));
    $('map-empty').textContent = { stopped: 'Start the dedicated server to see the live map.', disabled: 'Live map is off for the running server. Turn it on in Setup › Session configuration, save, then Restart Server.', waiting: 'Waiting for the first position update from the server. This starts once a mission is running (after the mission loads, or when a player picks a slot).', stale: '' }[s?.status] ?? '';
  }

  async function refresh() {
    try {
      snapshot = await api('/api/map');
      const frame = snapshot.frame;
      if (frame && (frame.world !== world || frame.worldSize !== size)) { world = frame.world; size = frame.worldSize; resetView(); backgroundKey = ''; }
      // Reload the image when its source changes (e.g. the terrain map finished extracting).
      const key = frame ? `${world}:${base}:${snapshot.background?.source}:${snapshot.background?.status}:${snapshot.topo?.status}` : '';
      if (frame && key !== backgroundKey) { backgroundKey = key; await loadBackground(world); }
      const bg = snapshot.background;
      const topo = snapshot.topo, sat = bg?.source === 'user' ? `your own image for ${world}` : bg?.status === 'ready' ? `the ${world} satellite map from your Arma 3 files` : '';
      const building = topo?.status === 'building' ? ` The topographic map is being built by the server (${topo.progress ?? 0}%).` : '';
      $('map-bg-note').textContent = !frame ? ''
        : base === 'grid' ? 'Grid only.'
        : background?.kind === 'topo' ? `Topographic map of ${world}, built from your server's terrain data.`
        : background ? `Showing ${sat || 'a map image'}.${base === 'topo' ? building || (topo?.status === 'none' && !snapshot.demo ? ' The topographic map will be built the next time the server starts with Live map on.' : '') : ''}`
        : bg?.status === 'extracting' ? `Loading the ${world} map from your Arma 3 files…${building}`
        : bg?.status === 'failed' ? `No satellite map: ${bg.error}${building}`
        : `No map image yet; showing the grid.${building}`;
      summary(); render();
    } catch (error) { $('map-updated').textContent = error.message; }
  }
  function start() { if (!timer) { void refresh(); timer = setInterval(() => { if (isVisible()) void refresh(); }, 1500); } }
  function stop() { clearInterval(timer); timer = null; }

  svg.addEventListener('wheel', event => {
    if (!view) return; event.preventDefault();
    const rect = svg.getBoundingClientRect(), fx = (event.clientX - rect.left) / rect.width, fy = (event.clientY - rect.top) / rect.height;
    const w = view.w * (event.deltaY > 0 ? 1.2 : 1 / 1.2);
    setView({ x: view.x + (view.w - w) * fx, y: view.y + (view.w - w) * fy, w });
  }, { passive: false });
  svg.addEventListener('pointerdown', event => { if (view) { drag = { x: event.clientX, y: event.clientY, view: { ...view } }; svg.setPointerCapture(event.pointerId); } });
  svg.addEventListener('pointermove', event => {
    const rect = svg.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - rect.left + 14}px`; tooltip.style.top = `${event.clientY - rect.top + 14}px`;
    if (!drag) return; const k = drag.view.w / rect.width;
    setView({ x: drag.view.x - (event.clientX - drag.x) * k, y: drag.view.y - (event.clientY - drag.y) * k, w: drag.view.w });
  });
  svg.addEventListener('pointerup', () => { drag = null; });
  $('map-zoom-in').addEventListener('click', () => view && setView({ x: view.x + view.w * 0.1, y: view.y + view.w * 0.1, w: view.w * 0.8 }));
  $('map-zoom-out').addEventListener('click', () => view && setView({ x: view.x - view.w * 0.125, y: view.y - view.w * 0.125, w: view.w * 1.25 }));
  $('map-zoom-reset').addEventListener('click', resetView);
  for (const id of ['map-ai', 'map-vehicles', 'map-markers', 'map-labels']) $(id).addEventListener('change', render);
  $('map-image-set').addEventListener('click', async () => {
    if (!world) { notify('Wait for the first map update so ArmaHost knows which terrain is loaded.', true); return; }
    let file = $('map-image-path').value.trim();
    if (window.armaDesktop) { file = await window.armaDesktop.pick('image').catch(() => null); if (!file) return; }
    if (!file) { notify('Enter the full path to a PNG or JPEG map image.', true); return; }
    try { await api('/api/map/background', { world, path: file }); await loadBackground(world); notify(`Map image saved for ${world}.`); } catch (error) { notify(error.message, true); }
  });
  $('map-image-clear').addEventListener('click', async () => { try { await api('/api/map/background/clear', { world }); await loadBackground(world); notify(`Map image removed for ${world}.`); } catch (error) { notify(error.message, true); } });
  if (window.armaDesktop) $('map-image-path').hidden = true;
  return { start, stop };
}
