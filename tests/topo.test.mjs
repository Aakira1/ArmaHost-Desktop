import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { topoScript, buildMapAddon } from '../src/map-addon.mjs';
import { readPbo } from '../src/pbo.mjs';
import { TopoBuilder } from '../src/topo.mjs';
import { contourSegments, contourLevels, heightAt } from '../public/topo-render.js';
import { createApp } from '../src/http.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
async function temp(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-topo-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function exportLines(id = '123', { n = 8, world = 'Altis', size = 8000, missingRow = false, endN = n } = {}) {
  const lines = [`AHTOPO|${id}|B|${world}|${size}|${n}`];
  for (let j = 0; j < n; j++) if (!(missingRow && j === 3)) lines.push(`AHTOPO|${id}|H|${j}|${Array.from({ length: n }, (_, i) => i + j - 4).join(',')}`);
  lines.push(`AHTOPO|${id}|G|4`);
  for (let j = 0; j < 4; j++) lines.push(`AHTOPO|${id}|T|${j}|1,2,3,4`);
  lines.push(`AHTOPO|${id}|P|50`);
  lines.push(`AHTOPO|${id}|R|MAIN ROAD~10.5~100~200~300~400~0^ROAD~6~1~2~3~4~1^BOGUS~1~1~1~1~1~0^TRACK~3~NaN~2~3~4~0`);
  lines.push(`AHTOPO|${id}|S|100~200~45~12~20^1e9~2~0~5~5^300~400~90~500~10`);
  lines.push(`AHTOPO|${id}|L|NameCity~Kavala <b>~3500~4200^Hill~~10~20^Evil~x~1~1`);
  lines.push(`AHTOPO|${id}|E|${endN}|4|2|2|2`);
  return lines;
}

test('topo export script is server-only, read-only, bounded, and skips cached terrains', () => {
  const sqf = topoScript(['Altis', 'Tanoa', 'bad name"; deleteVehicle player; "']);
  assert.match(sqf, /^if \(!isServer\) exitWith \{\};$/m);
  assert.match(sqf, /if \(\(toLower worldName\) in \["altis", "tanoa"\]\) exitWith \{\};/);
  for (const forbidden of ['callExtension', 'setPos', 'deleteVehicle', 'createVehicle', 'remoteExec', 'execVM', 'compile', 'setVariable']) assert.ok(!sqf.includes(forbidden), forbidden);
  for (const used of ['getTerrainHeightASL', 'nearestTerrainObjects', 'getRoadInfo', 'boundingBoxReal', 'nearestLocations', 'sleep']) assert.ok(sqf.includes(used), used);
  let depth = 0; for (const c of sqf) { if ('[{('.includes(c)) depth++; if (']})'.includes(c)) depth--; assert.ok(depth >= 0); } assert.equal(depth, 0);
  const pbo = readPbo(buildMapAddon(3, ['Stratis']));
  assert.ok(pbo.valid); assert.match(pbo.files['config.cpp'], /class topo \{ postInit = 1; \};/);
  assert.match(pbo.files['functions\\fn_topo.sqf'], /\["stratis"\]/);
});

test('a complete export is validated and cached; status goes building -> ready', async t => {
  const dir = await temp(t); const topo = new TopoBuilder(dir);
  const lines = exportLines();
  for (const line of lines.slice(0, 6)) assert.equal(topo.ingest(`12:00:00 "${line}"`), true);
  assert.equal((await topo.status('Altis')).status, 'building');
  for (const line of lines.slice(6)) topo.ingest(line);
  await topo.pending;
  assert.deepEqual(await topo.status('ALTIS'), { status: 'ready' });
  assert.deepEqual(await topo.cachedWorlds(), ['altis']);
  const data = JSON.parse(gunzipSync(await readFile(path.join(dir, 'altis.json.gz'))));
  assert.equal(data.n, 8); assert.equal(data.heights.length, 64); assert.equal(data.trees.length, 16);
  assert.deepEqual(data.roads, [['MAIN ROAD', 10.5, 100, 200, 300, 400, 0], ['ROAD', 6, 1, 2, 3, 4, 1]]);
  assert.deepEqual(data.buildings, [[100, 200, 45, 12, 20]]);
  assert.deepEqual(data.locations, [['NameCity', 'Kavala <b>', 3500, 4200], ['Hill', '', 10, 20]], 'names stay plain text; unknown types dropped');
  assert.equal(topo.ingest('ordinary RPT line'), false);
});

test('incomplete, mismatched and hostile exports are never cached', async t => {
  const dir = await temp(t); const topo = new TopoBuilder(dir);
  for (const line of exportLines('1', { missingRow: true })) topo.ingest(line);
  for (const line of exportLines('2', { endN: 9 })) topo.ingest(line);
  for (const line of exportLines('3', { world: '../../etc' })) topo.ingest(line);
  for (const line of exportLines('4', { n: 500 })) topo.ingest(line);
  topo.ingest('AHTOPO|5|H|0|1,2,3'); topo.ingest('AHTOPO|x|B|Altis|8000|8');
  await topo.pending;
  assert.deepEqual(await topo.cachedWorlds(), []);
  assert.deepEqual(await topo.status('Altis'), { status: 'none' });
  assert.equal(await topo.read('../x'), null);
});

test('contours trace the expected crossings, levels scale with terrain size, heights interpolate', () => {
  // 3x3 grid with a single peak in the middle.
  const peak = [0, 0, 0, 0, 10, 0, 0, 0, 0];
  const segs = contourSegments(peak, 3, 5);
  assert.equal(segs.length, 4);
  for (const s of segs) for (const v of s) assert.ok(v >= 0.5 && v <= 1.5, `segment near the peak: ${s}`);
  assert.deepEqual(contourSegments([0, 0, 0, 0], 2, 5), []);
  assert.deepEqual(contourLevels(-50, 100, 8000).map(l => l.value).slice(0, 5), [10, 20, 30, 40, 50]);
  assert.equal(contourLevels(0, 100, 8000).find(l => l.value === 50).major, true);
  assert.equal(contourLevels(0, 300, 30000)[0].value, 20);
  const data = { worldSize: 200, n: 2, heights: [0, 10, 20, 30] };
  assert.equal(heightAt(data, 50, 50), 0); assert.equal(heightAt(data, 100, 100), 15); assert.ok(Math.abs(heightAt(data, 150, 150) - 30) < 0.1);
});

test('demo mode builds and serves the topographic map end-to-end', async t => {
  const dir = await temp(t);
  const app = await createApp({ root, dir, demo: true, port: 0 });
  // Close the app (and its demo process) before the temp folder is removed: Windows can't delete a
  // running process's working directory.
  try {
    const headers = { 'X-Arma-Token': app.token, 'Content-Type': 'application/json' };
    await fetch(app.url + '/api/server/start', { method: 'POST', headers, body: '{}' });
    let snap;
    for (let i = 0; i < 60; i++) { snap = await (await fetch(app.url + '/api/map', { headers })).json(); if (snap.topo?.status === 'ready') break; await new Promise(r => setTimeout(r, 100)); }
    assert.equal(snap.topo.status, 'ready');
    const response = await fetch(app.url + '/api/map/topo?world=Demo', { headers });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.world, 'Demo'); assert.equal(data.heights.length, data.n * data.n); assert.ok(data.roads.length > 50 && data.buildings.length > 100);
    assert.equal((await fetch(app.url + '/api/map/topo?world=Nowhere', { headers })).status, 204);
    assert.equal((await fetch(app.url + '/api/map/topo?world=Demo')).status, 401);
    assert.ok(!app.logs.since(0).entries.some(e => e.message.includes('AHTOPO')), 'export lines stay out of the log');
  } finally { await app.close(); }
});
