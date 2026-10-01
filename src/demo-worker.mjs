// Harmless process used only by --demo; never loads or impersonates the game.
console.log('DEMO process started. This is not an Arma 3 server.');
const heartbeat = setInterval(() => console.log('DEMO heartbeat — process is alive; no game session or players.'), 4000);
// Synthetic Live map frames in the same AHMAP format the server addon writes, so the map UI can be tried.
let seq = 0;
const size = 8192, sides = ['WEST', 'EAST', 'GUER', 'CIV'];
function frame() {
  seq++; const t = seq * 2;
  const units = Array.from({ length: 24 }, (_, i) => {
    const angle = t / 40 + i * 0.7, radius = 900 + (i % 6) * 380;
    const x = Math.round(size / 2 + Math.cos(angle) * radius), y = Math.round(size / 2 + Math.sin(angle) * radius);
    return [i < 3 ? `Demo Player ${i + 1}` : `Demo AI ${i}`, sides[i % 4], x, y, Math.round((angle * 57.3 + 90) % 360), i < 3 ? 1 : 0, i % 7 === 0 ? 'Demo Truck' : '', `Alpha ${1 + (i % 3)}`].join('~');
  });
  const vehicles = [['Demo Truck', 'WEST', 3500, 4200, 45, 2, 1, 'Demo_Truck'], ['Demo Boat', 'CIV', 5200, 2900, 180, 0, 1, 'Demo_Boat'], ['Wreck', 'CIV', 4700, 5100, 0, 0, 0, 'Demo_Wreck']].map(v => v.join('~'));
  const markers = [['m_base', 'DEMO Base', 'mil_flag', 'ColorBLUFOR', 'ICON', 3400, 4300, 1, 1, 0, '1.00'], ['m_obj', 'DEMO Objective', 'mil_objective', 'ColorOPFOR', 'ICON', 5600, 5400, 1, 1, 0, '1.00'], ['m_area', 'DEMO AO', 'Empty', 'ColorOrange', 'ELLIPSE', 4800, 4800, 900, 600, 30, '0.40']].map(m => m.join('~'));
  console.log(`AHMAP|F|${seq}|${t}|Demo|${size}|2`);
  console.log(`AHMAP|U|${seq}|${units.join('^')}`);
  console.log(`AHMAP|V|${seq}|${vehicles.join('^')}`);
  console.log(`AHMAP|M|${seq}|${markers.join('^')}`);
  console.log(`AHMAP|E|${seq}|${units.length}|${vehicles.length}|${markers.length}`);
}
// Synthetic terrain export in the same AHTOPO format the server addon writes (demo only).
function topo() {
  const id = String(Date.now()), lines = [], out = line => lines.push(`AHTOPO|${id}|${line}`);
  const n = 160, cell = size / n, fn = 80, fcell = size / fn;
  const island = (x, y) => { const dx = (x - size / 2) / (size / 2), dy = (y - size / 2) / (size / 2); return 120 * (0.62 - Math.hypot(dx * 1.1, dy * 1.35) + 0.18 * Math.sin(x / 700) * Math.cos(y / 900) + 0.1 * Math.sin((x + y) / 420)); };
  out(`B|Demo|${size}|${n}`);
  for (let j = 0; j < n; j++) out(`H|${j}|${Array.from({ length: n }, (_, i) => Math.round(island((i + 0.5) * cell, (j + 0.5) * cell))).join(',')}`);
  out(`G|${fn}`);
  for (let j = 0; j < fn; j++) out(`T|${j}|${Array.from({ length: fn }, (_, i) => { const h = island((i + 0.5) * fcell, (j + 0.5) * fcell); return h > 15 && h < 60 && Math.sin(i * 0.7) * Math.cos(j * 0.5) > -0.1 ? Math.round(10 + (h % 30)) : 0; }).join(',')}`);
  const roads = []; let px = null, py = null;
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) { const x = Math.round(size / 2 + Math.cos(a) * 2200), y = Math.round(size / 2 + Math.sin(a) * 1700); if (px !== null) roads.push(`MAIN ROAD~10~${px}~${py}~${x}~${y}~0`); px = x; py = y; }
  for (let t = 0; t < 1; t += 0.04) roads.push(`ROAD~6~${Math.round(3400 + t * 2200)}~${Math.round(4300 + t * 1100)}~${Math.round(3400 + (t + 0.04) * 2200)}~${Math.round(4300 + (t + 0.04) * 1100)}~0`);
  for (let t = 0; t < 1; t += 0.05) roads.push(`TRACK~3~${Math.round(2600 + t * 1400)}~${Math.round(5200 - t * 2400)}~${Math.round(2600 + (t + 0.05) * 1400)}~${Math.round(5200 - (t + 0.05) * 2400)}~0`);
  out(`R|${roads.join('^')}`);
  const towns = [['NameCityCapital', 'Demo City', 3500, 4250], ['NameVillage', 'Northwood', 5500, 5350], ['NameVillage', 'Southport', 4100, 2700], ['NameLocal', 'Old Quarry', 2700, 4900], ['Hill', '', 4600, 4100], ['NameMarine', 'Demo Bay', 6500, 3000], ['Airport', 'Demo Airfield', 5000, 3500]];
  const buildings = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [type, , x, y] of towns) if (type.startsWith('Name') && type !== 'NameMarine') for (let b = 0; b < (type === 'NameCityCapital' ? 120 : 40); b++) buildings.push([Math.round(x + (rnd() - 0.5) * 600), Math.round(y + (rnd() - 0.5) * 500), Math.round(rnd() * 90), Math.round(8 + rnd() * 14), Math.round(8 + rnd() * 18)].join('~'));
  for (let b = 0; b < buildings.length; b += 40) out(`S|${buildings.slice(b, b + 40).join('^')}`);
  out(`L|${towns.map(t => t.join('~')).join('^')}`);
  out(`E|${n}|${fn}|${roads.length}|${buildings.length}|${towns.length}`);
  // Write in small batches so a slow reader never blocks this process (pipe writes are synchronous on Windows).
  const flush = () => { for (const line of lines.splice(0, 20)) console.log(line); if (lines.length) setTimeout(flush, 5); };
  flush();
}
frame();
setTimeout(topo, 500);
const mapTimer = setInterval(frame, 2000);
function stop() { clearInterval(heartbeat); clearInterval(mapTimer); console.log('DEMO process stopped.'); process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
