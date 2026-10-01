import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packPbo, readPbo } from '../src/pbo.mjs';
import { buildMapAddon, feedScript, CONFIG_CPP, writeMapAddon, LIMITS } from '../src/map-addon.mjs';
import { LiveMap } from '../src/live-map.mjs';
import { MapBackgrounds } from '../src/map-backgrounds.mjs';
import { defaults, validateSettings, serverArgs } from '../src/config.mjs';
import { LogBook, RptTail } from '../src/logs.mjs';
import { createApp } from '../src/http.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
async function temporary(fn) { const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-map-')); try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
const frame = (seq, { units = ['Alpha 1~WEST~100~200~90~1~~Alpha'], vehicles = [], markers = [], counts } = {}) => [
  `AHMAP|F|${seq}|60|Altis|30720|3`,
  ...(units.length ? [`AHMAP|U|${seq}|${units.join('^')}`] : []),
  ...(vehicles.length ? [`AHMAP|V|${seq}|${vehicles.join('^')}`] : []),
  ...(markers.length ? [`AHMAP|M|${seq}|${markers.join('^')}`] : []),
  `AHMAP|E|${seq}|${(counts || [units.length, vehicles.length, markers.length]).join('|')}`];

test('PBO packer round-trips files, prefix and a valid SHA-1 trailer deterministically', () => {
  const pbo = packPbo({ 'config.cpp': 'class X {};', 'functions\\fn_a.sqf': 'hint "x";' }, { prefix: 'demo_addon' });
  const parsed = readPbo(pbo);
  assert.equal(parsed.valid, true); assert.equal(parsed.extensions.prefix, 'demo_addon');
  assert.deepEqual(parsed.files, { 'config.cpp': 'class X {};', 'functions\\fn_a.sqf': 'hint "x";' });
  assert.ok(packPbo({ 'a.txt': 'x' }, { prefix: 'p' }).equals(packPbo({ 'a.txt': 'x' }, { prefix: 'p' })));
  const corrupt = Buffer.from(pbo); corrupt[30] ^= 1; assert.equal(readPbo(corrupt).valid, false);
  assert.throws(() => packPbo({ '../evil': 'x' }, { prefix: 'p' }), /Invalid PBO entry/);
});

test('generated map addon is server-only, read-only and bounded', () => {
  const parsed = readPbo(buildMapAddon(4));
  assert.equal(parsed.valid, true); assert.equal(parsed.extensions.prefix, 'armahost_map');
  assert.match(parsed.files['config.cpp'], /class CfgPatches[\s\S]*class armahost_map/);
  assert.match(parsed.files['config.cpp'], /postInit = 1/);
  const sqf = parsed.files['functions\\fn_feed.sqf'];
  assert.match(sqf, /^if \(!isServer\) exitWith \{\};$/m);
  assert.match(sqf, /private _base = 4;/);
  assert.ok(sqf.includes(`select [0, ${LIMITS.units}]`) && sqf.includes(`select [0, ${LIMITS.markers}]`));
  assert.match(sqf, /splitString _bad/);
  for (const forbidden of ['callExtension', 'setPos', 'deleteVehicle', 'createVehicle', 'remoteExec', 'execVM', 'compile']) assert.ok(!sqf.includes(forbidden), forbidden);
  assert.throws(() => feedScript(1)); assert.throws(() => feedScript(31));
  assert.equal(CONFIG_CPP.includes('\\armahost_map\\functions'), true);
});

test('live map setting adds the addon to -serverMod only when enabled, merged with server mods', () => {
  const ctx = { configFile: 'C:/d/server.cfg', profilesDir: 'C:/d/profiles', mapAddonDir: 'C:/d/runtime/@ArmaHostMap' };
  const mods = [{ path: 'C:/m/server', enabled: true, scope: 'server' }];
  assert.ok(!serverArgs(validateSettings({ ...defaults(), mods }), ctx).join(' ').includes('@ArmaHostMap'));
  assert.ok(serverArgs(validateSettings({ ...defaults(), mods, liveMap: true }), ctx).includes('-serverMod=C:/m/server;C:/d/runtime/@ArmaHostMap'));
  assert.ok(serverArgs(validateSettings({ ...defaults(), liveMap: true }), ctx).includes('-serverMod=C:/d/runtime/@ArmaHostMap'));
  assert.throws(() => serverArgs(validateSettings({ ...defaults(), liveMap: true }), { ...ctx, mapAddonDir: 'C:/a;b/@ArmaHostMap' }), /semicolon/);
  for (const liveMapInterval of [1, 31, 2.5, '3']) assert.throws(() => validateSettings({ ...defaults(), liveMapInterval }), /interval/);
  assert.equal(validateSettings({ serverName: 'Legacy' }).liveMap, false);
});

test('writeMapAddon writes a valid PBO in an addons folder', () => temporary(async dir => {
  const file = await writeMapAddon(path.join(dir, '@ArmaHostMap'), 3);
  assert.equal(file, path.join(dir, '@ArmaHostMap', 'addons', 'armahost_map.pbo'));
  assert.equal(readPbo(await readFile(file)).valid, true);
}));

test('frames publish only when complete; partial, mismatched and over-count frames are ignored', () => {
  let now = 1000; const map = new LiveMap(() => now);
  for (const line of frame(1, { vehicles: ['Hunter~WEST~150~250~0~2~1~B_MRAP_01_F'], markers: ['m1~Base~mil_flag~ColorBLUFOR~ICON~10~20~1~1~0~1.00'] })) assert.equal(map.ingest(` 9:00:01 ${line}`), true);
  let snap = map.snapshot({ running: true, enabled: true });
  assert.equal(snap.status, 'live'); assert.equal(snap.frame.world, 'Altis'); assert.equal(snap.frame.worldSize, 30720);
  assert.deepEqual(snap.frame.units[0], { name: 'Alpha 1', side: 'WEST', x: 100, y: 200, dir: 90, player: true, vehicle: '', group: 'Alpha' });
  assert.equal(snap.frame.vehicles[0].crew, 2); assert.equal(snap.frame.markers[0].text, 'Base');
  const [f, u] = frame(2, { units: ['Bravo~EAST~1~2~0~0~~B', 'Charlie~EAST~3~4~0~0~~B'] });
  map.ingest(f); map.ingest(u); // no end line yet
  assert.equal(map.snapshot({ running: true, enabled: true }).frame.units[0].name, 'Alpha 1', 'incomplete frame is not published');
  for (const line of frame(3, { counts: [0, 0, 0] })) map.ingest(line); // announced fewer records than sent
  assert.equal(map.snapshot({ running: true, enabled: true }).frame.units[0].name, 'Alpha 1');
  map.ingest('AHMAP|F|4|0|Altis|30720|3'); map.ingest('AHMAP|U|99|X~WEST~1~1~0~0~~'); map.ingest('AHMAP|E|4|0|0|0');
  assert.equal(map.snapshot({ running: true, enabled: true }).frame.units.length, 0, 'records from another frame are dropped');
  assert.equal(map.ingest('ordinary RPT line'), false);
  now += 20000; assert.equal(map.snapshot({ running: true, enabled: true }).status, 'stale');
  assert.equal(map.snapshot({ running: false, enabled: true }).status, 'stopped');
  assert.equal(map.snapshot({ running: true, enabled: false }).status, 'disabled');
});

test('hostile or malformed records are bounded and parsed as data', () => {
  const map = new LiveMap();
  const units = [`${'<img src=x onerror=alert(1)>'.repeat(10)}~NOTASIDE~1e9~5~720~1~~`, 'Ok~GUER~10~NaN~0~0~~', 'Good~GUER~10~20~45~0~Car~G'];
  for (const line of frame(1, { units, markers: ['m~t~x~c~POLYGON~1~2~3~4~5~9'] })) map.ingest(line + '"');
  const f = map.snapshot({ running: true, enabled: true }).frame;
  assert.equal(f.units.length, 1); assert.equal(f.units[0].name, 'Good');
  assert.equal(f.markers[0].shape, 'ICON'); assert.equal(f.markers[0].alpha, 1);
  map.ingest('AHMAP|F|2|0|../../etc|0|3'); map.ingest('AHMAP|E|2|0|0|0');
  assert.equal(map.snapshot({ running: true, enabled: true }).frame.world, 'Altis', 'a frame with no world size is ignored');
});

test('RPT tail routes AHMAP lines to the map and keeps them out of the log', () => temporary(async dir => {
  const logs = new LogBook(dir); const map = new LiveMap();
  const tail = new RptTail(dir, logs, Date.now() - 5000); tail.filter = line => map.ingest(line);
  await writeFile(path.join(dir, 'arma3server_x64.rpt'), ['10:00:00 Mission loaded', ...frame(1).map(l => `10:00:01 ${l}`), '10:00:02 Game started.', ''].join('\n'));
  await tail.poll();
  const messages = logs.since(0).entries.map(e => e.message);
  assert.ok(messages.some(m => m.includes('Mission loaded')) && messages.some(m => m.includes('Game started')));
  assert.ok(!messages.some(m => m.includes('AHMAP')));
  assert.equal(map.snapshot({ running: true, enabled: true }).frame.units.length, 1);
}));

test('map images: PNG/JPEG only, bounded, per terrain, and removable', () => temporary(async dir => {
  const backgrounds = new MapBackgrounds(dir);
  const png = path.join(dir, 'map.png'); await writeFile(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]));
  const fake = path.join(dir, 'fake.png'); await writeFile(fake, 'not an image');
  assert.deepEqual(await backgrounds.set('Altis', png), { world: 'Altis', type: 'image/png' });
  assert.equal((await backgrounds.get('Altis')).type, 'image/png');
  await assert.rejects(backgrounds.set('Altis', fake), /PNG or JPEG/);
  await assert.rejects(backgrounds.set('../etc', png), /terrain/);
  await assert.rejects(backgrounds.set('Altis', 'relative.png'), /absolute/);
  await backgrounds.clear('Altis'); assert.equal(await backgrounds.get('Altis'), null);
}));

test('demo mode serves live map frames end-to-end over the authenticated API', () => temporary(async dir => {
  const app = await createApp({ root, dir, demo: true, port: 0 });
  const headers = { 'X-Arma-Token': app.token, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(app.url + '/api/map')).status, 401);
    assert.equal((await (await fetch(app.url + '/api/map', { headers })).json()).status, 'stopped');
    await fetch(app.url + '/api/server/start', { method: 'POST', headers, body: '{}' });
    let snap;
    for (let i = 0; i < 40; i++) { snap = await (await fetch(app.url + '/api/map', { headers })).json(); if (snap.frame) break; await new Promise(r => setTimeout(r, 100)); }
    assert.equal(snap.status, 'live'); assert.equal(snap.frame.world, 'Demo'); assert.ok(snap.frame.units.length > 10);
    assert.ok(!app.logs.since(0).entries.some(e => e.message.includes('AHMAP')), 'frames stay out of the log');
    assert.match((await fetch(app.url + '/', {})).headers.get('content-security-policy'), /img-src 'self' blob:/);
    assert.equal((await fetch(app.url + '/api/map/background?world=Demo', { headers })).status, 204);
    assert.equal((await fetch(app.url + '/api/map/background?world=../x', { headers })).status, 400);
  } finally { await app.close(); }
}));
