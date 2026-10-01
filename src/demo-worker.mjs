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
frame();
const mapTimer = setInterval(frame, 2000);
function stop() { clearInterval(heartbeat); clearInterval(mapTimer); console.log('DEMO process stopped.'); process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
