import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { buildCoopMission, writeCoopMission, validateCoopOptions, COOP_WORLDS } from '../src/coop-mission.mjs';
import { validateSettings, defaults, renderConfig } from '../src/config.mjs';
import { createApp } from '../src/http.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Brackets and quotes must balance (strings are skipped), or Arma refuses to load the file.
function balanced(text) {
  const stack = []; const pairs = { '}': '{', ']': '[', ')': '(' };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { const end = text.indexOf('"', i + 1); if (end < 0) return false; i = end; continue; }
    if ('{[('.includes(c)) stack.push(c);
    else if ('}])'.includes(c)) { if (stack.pop() !== pairs[c]) return false; }
  }
  return stack.length === 0;
}
// Every "items=N;" must be followed by exactly classes Item0..Item(N-1) at that level.
function itemCountsMatch(sqm) {
  const lines = sqm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\t*)items=(\d+);$/.exec(lines[i]); if (!m) continue;
    const indent = m[1]; const names = [];
    for (let j = i + 1; j < lines.length && !lines[j].startsWith(indent.slice(1) + '}'); j++) {
      const c = new RegExp(`^${indent}class (Item\\d+)$`).exec(lines[j]); if (c) names.push(c[1]);
    }
    if (names.join() !== Array.from({ length: Number(m[2]) }, (_, k) => `Item${k}`).join()) return false;
  }
  return true;
}

test('co-op starter: playable BLUFOR slots, valid structure for every map and size', () => {
  for (const { world } of COOP_WORLDS) for (const slots of [2, 8, 9, 16]) {
    const m = buildCoopMission({ world, slots });
    assert.equal(m.folderName, `ArmaHost_Coop.${world}`);
    const sqm = m.files['mission.sqm'];
    assert.ok(balanced(sqm), `${world}/${slots} sqm balanced`); assert.ok(itemCountsMatch(sqm), `${world}/${slots} item counts`);
    assert.equal((sqm.match(/isPlayable=1;/g) || []).length, slots);
    assert.equal((sqm.match(/dataType="Group";/g) || []).length, Math.ceil(slots / 8));
    assert.ok(!/side="(?!West)/.test(sqm)); assert.match(sqm, /^version=54;/);
    assert.match(sqm, /addons\[\]=\n\{\n\};/, 'no declared add-ons'); assert.ok(!/AddonsMetaData|A3_Characters_F/i.test(sqm));
    const ids = [...sqm.matchAll(/^\t*id=(\d+);$/gm)].map(x => Number(x[1]));
    assert.equal(new Set(ids).size, ids.length, 'unique ids'); assert.match(sqm, new RegExp(`nextID=${ids.length};`));
    for (const name of ['description.ext', 'initServer.sqf', 'initPlayerLocal.sqf']) assert.ok(balanced(m.files[name]), `${world}/${slots} ${name}`);
    assert.match(m.files['description.ext'], new RegExp(`maxPlayers = ${slots};`)); assert.match(m.files['description.ext'], /gameType = Coop;/);
    assert.match(m.files['description.ext'], /respawn = 3;/); assert.match(m.files['description.ext'], /disabledAI = 1;/);
  }
});

test('co-op starter scripts: safe start, respawn marker, Arsenal and Zeus only when chosen', () => {
  const full = buildCoopMission({ world: 'Altis', slots: 8 }).files;
  assert.match(full['initServer.sqf'], /BIS_fnc_findSafePos/); assert.match(full['initServer.sqf'], /createMarker \["respawn_west"/);
  assert.match(full['initServer.sqf'], /ModuleCurator_F/); assert.match(full['initServer.sqf'], /assignCurator/); assert.match(full['initServer.sqf'], /admin \(owner _x\) > 0/);
  assert.match(full['initServer.sqf'], /B_supplyCrate_F/); assert.match(full['initPlayerLocal.sqf'], /BIS_fnc_arsenal/);
  assert.match(full['initPlayerLocal.sqf'], /setPosATL/);
  const bare = buildCoopMission({ world: 'Stratis', slots: 4, zeus: false, arsenal: false }).files;
  assert.ok(!/ModuleCurator_F|assignCurator/.test(bare['initServer.sqf'])); assert.ok(!/B_supplyCrate_F/.test(bare['initServer.sqf']));
  assert.ok(!/BIS_fnc_arsenal/.test(bare['initPlayerLocal.sqf'])); assert.match(bare['initServer.sqf'], /publicVariable "ARMAHOST_box"/, 'clients never wait forever');
  for (const bad of [{ world: 'Chernarus' }, { world: 'Altis', slots: 1 }, { world: 'Altis', slots: 17 }, { world: 'Altis', slots: 2.5 }, { world: '../x' }]) assert.throws(() => validateCoopOptions(bad));
  assert.equal(validateSettings({ ...defaults(), mission: 'ArmaHost_Coop.Enoch' }).mission, 'ArmaHost_Coop.Enoch');
  assert.match(renderConfig(validateSettings({ ...defaults(), mission: 'ArmaHost_Coop.Altis' })), /template = "ArmaHost_Coop.Altis";/);
});

test('co-op starter is written into MPMissions and never overwrites a folder ArmaHost did not make', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-coop-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const serverExe = path.join(dir, 'Arma 3 Server', 'arma3server_x64.exe');
  const first = await writeCoopMission(serverExe, { world: 'Malden', slots: 6 });
  assert.equal(first.template, 'ArmaHost_Coop.Malden');
  assert.match(await readFile(path.join(dir, 'Arma 3 Server', 'MPMissions', 'ArmaHost_Coop.Malden', 'mission.sqm'), 'utf8'), /isPlayable=1/);
  await writeCoopMission(serverExe, { world: 'Malden', slots: 10 }); // ArmaHost's own folder can be replaced
  const theirs = path.join(dir, 'Arma 3 Server', 'MPMissions', 'ArmaHost_Coop.Altis'); await mkdir(theirs, { recursive: true }); await writeFile(path.join(theirs, 'mission.sqm'), 'mine');
  await assert.rejects(writeCoopMission(serverExe, { world: 'Altis' }), /wasn't made by ArmaHost/);
  assert.equal(await readFile(path.join(theirs, 'mission.sqm'), 'utf8'), 'mine');
  await assert.rejects(writeCoopMission('', { world: 'Altis' }), /server executable/);
});

test('API: creating the co-op starter selects it as the mission', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-coop-api-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await createApp({ root, dir, demo: true, port: 0 });
  try {
    const headers = { 'X-Arma-Token': app.token, 'Content-Type': 'application/json' };
    const post = async (route, body) => { const r = await fetch(app.url + route, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const ok = await post('/api/missions/create-coop', { world: 'Altis', slots: 8 });
    assert.equal(ok.status, 200); assert.equal(ok.body.state.settings.mission, 'ArmaHost_Coop.Altis');
    assert.equal((await post('/api/missions/create-coop', { world: 'Nope', slots: 8 })).status, 409);
  } finally { await app.close(); }
});
