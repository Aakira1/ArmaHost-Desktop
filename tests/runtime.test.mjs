import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaults } from '../src/config.mjs';
import { LogBook, RptTail } from '../src/logs.mjs';
import { scanMissions, scanMods, parseLibraryPaths } from '../src/discovery.mjs';
import { ProcessManager } from '../src/process-manager.mjs';
import { createApp } from '../src/http.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function temporary(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-runtime-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('logs redact secrets and maintain bounded monotonic cursors', async () => temporary(async dir => {
  const logs = new LogBook(dir);
  logs.setSecrets(['very-secret', 'admin-value']);
  logs.add('password very-secret admin-value', 'server');
  assert.ok(!JSON.stringify(logs.since(0)).includes('very-secret'));
  for (let i = 0; i < 1100; i++) logs.add(`Line ${i}`);
  assert.ok(logs.since(0).entries.length <= 1000);
  const cursor = logs.since(0).cursor;
  assert.equal(logs.since(cursor).entries.length, 0);
  assert.ok(!((await readFile(path.join(dir, 'manager.log'), 'utf8')).includes('very-secret')));
}));
test('mission scan reads server MPMissions only, files and valid folders', async () => temporary(async dir => {
  const mp = path.join(dir, 'MPMissions'); await mkdir(mp);
  await writeFile(path.join(mp, 'Coop.Altis.pbo'), 'fake fixture');
  await mkdir(path.join(mp, 'Patrol.Stratis'));
  await writeFile(path.join(mp, 'Patrol.Stratis', 'mission.sqm'), '// fixture');
  await writeFile(path.join(mp, 'not-a-mission.txt'), '');
  const found = await scanMissions(path.join(dir, 'arma3server_x64.exe'));
  assert.deepEqual(found.missions.map(m => m.template), ['Coop.Altis', 'Patrol.Stratis']);
}));
test('mod scan detects addon folders and uses metadata as text, not code', async () => temporary(async dir => {
  await mkdir(path.join(dir, '@Test', 'addons'), { recursive: true });
  await writeFile(path.join(dir, '@Test', 'mod.cpp'), 'name = "Example Mod";');
  await mkdir(path.join(dir, 'unrelated'));
  const found = await scanMods([dir]);
  assert.equal(found.mods.length, 1); assert.equal(found.mods[0].name, 'Example Mod');
  assert.deepEqual(parseLibraryPaths('"path" "D:\\\\SteamLibrary"'), ['D:\\SteamLibrary']);
}));
test('RPT tail emits newly appended lines without replaying partial lines', async () => temporary(async dir => {
  const logs = new LogBook(dir); const tail = new RptTail(dir, logs, Date.now() - 1000);
  const file = path.join(dir, 'arma3server_test.rpt');
  await writeFile(file, 'first\npar'); await tail.poll();
  assert.equal(logs.since(0).entries.filter(e => e.source === 'rpt').length, 1);
  await writeFile(file, 'first\npartial\n'); await tail.poll();
  const lines = logs.since(0).entries.filter(e => e.source === 'rpt');
  assert.equal(lines[1].message, 'partial');
}));
test('demo manages a real child, blocks duplicate starts, snapshots settings and stops', async () => temporary(async dir => {
  const logs = new LogBook(dir); const manager = new ProcessManager({ dir, logs, demo: true });
  try {
    const s = { ...defaults(), password: 'active-password' };
    await manager.start(s);
    assert.equal(manager.status().state, 'running'); assert.ok(manager.status().pid > 0);
    s.password = 'edited';
    assert.equal(manager.activeSettings.password, 'active-password');
    await assert.rejects(manager.start(s), /already|busy/i);
    const first = manager.status().pid;
    await manager.restart(s);
    assert.notEqual(manager.status().pid, first);
    await manager.join(defaults());
    await pause(150);
    assert.ok(logs.since(0).entries.some(e => /DEMO/.test(e.message)));
    await manager.stop(); assert.equal(manager.status().state, 'stopped');
  } finally { await manager.close(); }
}));
test('live starts fail clearly on a non-Windows host without spawning', { skip: process.platform === 'win32' }, async () => temporary(async dir => {
  const manager = new ProcessManager({ dir, logs: new LogBook(dir), demo: false });
  await assert.rejects(manager.start(defaults()), /Windows/);
  assert.equal(manager.status().pid, null);
  await manager.close();
}));
test('HTTP serves UI; authenticates every API; rejects hostile origins and hosts', async () => temporary(async dir => {
  const app = await createApp({ root, dir, demo: true, port: 0 });
  const base = app.url;
  const headers = { 'X-Arma-Token': app.token, 'Content-Type': 'application/json' };
  const post = (route, body = {}, extra = {}) => fetch(base + route, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    const page = await fetch(base + '/'); assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(base + '/api/state')).status, 401);
    assert.equal((await fetch(base + '/api/state', { headers })).status, 200);
    assert.equal((await post('/api/server/start', {}, { Origin: 'https://evil.example' })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
      http.get(base + '/api/state', { headers: { ...headers, Host: 'evil.example' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(base + '/src/config.mjs')).status, 404);
    assert.equal((await fetch(base + '/data/state.json')).status, 404);
    assert.equal((await post('/api/config', { settings: { ...defaults(), port: 0 }, revision: 0 })).status, 400);
    assert.equal((await post('/api/config', { settings: defaults(), revision: 0 })).status, 200);
    assert.equal((await post('/api/config', { settings: defaults(), revision: 0 })).status, 409);
    assert.equal((await post('/api/server/start')).status, 200);
    const state = await (await fetch(base + '/api/state', { headers })).json();
    assert.equal(state.status.state, 'running');
    assert.equal((await post('/api/server/start')).status, 409);
    assert.equal((await post('/api/server/stop')).status, 200);
  } finally { await app.close(); }
}));

test('malformed session keys are unauthorized rather than internal errors', async () => temporary(async dir => {
  const app = await createApp({ root, dir, demo: true, port: 0 });
  try {
    for (const key of ['a'.repeat(63), 'a'.repeat(65), 'é'.repeat(64), 'g'.repeat(64)]) {
      const response = await fetch(app.url + '/api/state', { headers: { 'X-Arma-Token': key } });
      assert.equal(response.status, 401, `Malformed key must be rejected: ${key.length} characters`);
    }
  } finally { await app.close(); }
}));

test('API rejects oversized JSON, cross-site fetches and null origins', async () => temporary(async dir => {
  const app = await createApp({ root, dir, demo: true, port: 0 });
  const headers = { 'X-Arma-Token': app.token, 'Content-Type': 'application/json' };
  try {
    for (const extra of [{ Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await fetch(app.url + '/api/state', { headers: { ...headers, ...extra } })).status, 403);
    }
    assert.equal((await fetch(app.url + '/api/config', { method: 'POST', headers, body: JSON.stringify({ oversized: 'x'.repeat(131072) }) })).status, 413);
    assert.equal((await fetch(app.url + '/api/config', { method: 'POST', headers, body: '{broken' })).status, 400);
    assert.equal((await fetch(app.url + '/api/config', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  } finally { await app.close(); }
}));
