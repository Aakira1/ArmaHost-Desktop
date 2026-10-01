import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults, validateSettings, renderConfig, serverArgs, clientArgs, redactArgs } from '../src/config.mjs';
import { Store } from '../src/store.mjs';

const settings = () => ({ ...defaults(), gameExe: 'C:\\Games\\Arma 3\\arma3_x64.exe', serverExe: 'C:\\Games\\Arma 3 Server\\arma3server_x64.exe' });

test('defaults are local-only and preserve anti-cheat/signature checks', () => {
  const s = validateSettings(defaults());
  assert.equal(s.lan, false); assert.equal(s.battleye, true); assert.equal(s.verifySignatures, 2);
  assert.equal(s.port, 2302); assert.equal(s.autoInit, false);
});
test('reject invalid ports, booleans, unknown options and non-object payloads', () => {
  for (const port of [0, 65532, 3000.5, '2302', null]) assert.throws(() => validateSettings({ ...settings(), port }));
  assert.throws(() => validateSettings({ ...settings(), lan: 'false' }));
  assert.throws(() => validateSettings({ ...settings(), command: 'calc.exe' }));
  for (const value of [null, [], '']) assert.throws(() => validateSettings(value));
});
test('LAN requires a password; auto-init requires a mission and persistence', () => {
  // A join password is optional: an open server is allowed.
  assert.equal(validateSettings({ ...settings(), lan: true }).lan, true);
  assert.throws(() => validateSettings({ ...settings(), autoInit: true }), /mission/i);
  assert.throws(() => validateSettings({ ...settings(), autoInit: true, mission: 'Test.Altis', persistent: false }), /persistent/i);
});
test('reject configuration injection and mod separators but allow spaces and unicode paths', () => {
  assert.throws(() => validateSettings({ ...settings(), mission: 'a\"; shutdown=1;' }));
  assert.throws(() => validateSettings({ ...settings(), password: 'bad\nthing' }));
  assert.throws(() => validateSettings({ ...settings(), serverName: 'bad\"name' }));
  for (const p of ['C:\\Mods\\a;b', 'C:\\Mods\\\"a', 'relative/path']) {
    assert.throws(() => validateSettings({ ...settings(), mods: [{ path: p, scope: 'shared', enabled: true }] }));
  }
  const s = validateSettings({ ...settings(), mods: [{ path: 'C:\\Jeux été\\@Test mod', scope: 'shared', enabled: true }] });
  assert.equal(s.mods.length, 1);
});
test('generate local server configuration with mission rotation and no arbitrary config', () => {
  const s = validateSettings({ ...settings(), serverName: 'Local Operations', mission: 'COOP 10.Altis', password: 's3cret', adminPassword: 'adminSecret' });
  const text = renderConfig(s);
  assert.match(text, /loopback = 1;/); assert.match(text, /upnp = 0;/);
  assert.match(text, /template = "COOP 10.Altis";/); assert.match(text, /difficulty = "Regular";/);
  assert.match(text, /password = "s3cret";/);
  const preview = renderConfig(s, true);
  assert.ok(!preview.includes('s3cret')); assert.ok(!preview.includes('adminSecret'));
});
test('construct shell-free argv with correct mod scopes and redacted passwords', () => {
  const s = validateSettings({ ...settings(), password: 'secret', mods: [
    { path: 'C:\\mods\\@Shared Mod', scope: 'shared', enabled: true },
    { path: 'C:\\mods\\@Server', scope: 'server', enabled: true },
    { path: 'C:\\mods\\@Client', scope: 'client', enabled: true },
    { path: 'C:\\mods\\@Off', scope: 'shared', enabled: false }
  ] });
  const args = serverArgs(s, { configFile: 'C:\\Local Host\\server.cfg', profilesDir: 'C:\\Local Host\\profiles' });
  assert.ok(args.includes('-config=C:\\Local Host\\server.cfg'));
  assert.ok(args.includes('-ip=127.0.0.1'));
  assert.ok(args.includes('-mod=C:\\mods\\@Shared Mod'));
  assert.ok(args.includes('-serverMod=C:\\mods\\@Server'));
  assert.ok(!args.join(' ').includes('@Client'));
  const join = clientArgs(s);
  assert.ok(join.includes('-connect=127.0.0.1'));
  assert.ok(join.includes('-mod=C:\\mods\\@Shared Mod;C:\\mods\\@Client'));
  assert.ok(!redactArgs(join).join(' ').includes('secret'));
});
test('normalise empty mission and reject incomplete executable names', () => {
  assert.equal(validateSettings({ ...settings(), mission: '  ' }).mission, '');
  assert.throws(() => validateSettings({ ...settings(), gameExe: 'C:\\calc.exe' }), /arma3/i);
  assert.throws(() => validateSettings({ ...settings(), serverExe: 'C:\\arma3server_x64.exe.bat' }));
});
test('store atomically persists state and refuses stale revisions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-store-'));
  try {
    const store = await Store.open(dir);
    const s = { ...store.snapshot().settings, serverName: 'Saved Session' };
    await store.saveSettings(s, 0);
    assert.equal(store.snapshot().revision, 1);
    await assert.rejects(store.saveSettings(s, 0), /changed|stale/i);
    const reloaded = await Store.open(dir);
    assert.equal(reloaded.snapshot().settings.serverName, 'Saved Session');
    const raw = await readFile(path.join(dir, 'state.json'), 'utf8');
    assert.equal(JSON.parse(raw).revision, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('presets have opaque IDs, save/load/delete and revision checks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-presets-'));
  try {
    const store = await Store.open(dir);
    const preset = await store.createPreset('Friday co-op', 0);
    assert.match(preset.id, /^[a-f0-9-]{36}$/);
    await store.saveSettings({ ...defaults(), port: 2402 }, 1);
    await store.loadPreset(preset.id, 2);
    assert.equal(store.snapshot().settings.port, 2302);
    await store.deletePreset(preset.id, 3);
    assert.equal(store.snapshot().presets.length, 0);
    await assert.rejects(store.loadPreset('../../secret', 4));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('corrupt state is preserved, not replaced with defaults', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-corrupt-'));
  try {
    await writeFile(path.join(dir, 'state.json'), '{bad');
    await assert.rejects(Store.open(dir), /state\.json/);
    assert.equal(await readFile(path.join(dir, 'state.json'), 'utf8'), '{bad');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
