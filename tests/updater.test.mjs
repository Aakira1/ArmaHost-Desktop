import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, releaseAsset, DesktopUpdater } from '../desktop/updater.mjs';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
test('updater compares stable versions and validates Windows release assets', () => {
  assert.equal(newerVersion('v1.3.1', '1.3.0'), true);
  assert.equal(newerVersion('v1.3.0', '1.3.0'), false);
  assert.equal(newerVersion('v1.3.1-beta', '1.3.0'), false);
  const asset = { name: 'ArmaHost.Desktop.Setup.1.3.1.exe', id: 12, size: 100, digest: 'sha256:' + 'a'.repeat(64) };
  assert.equal(releaseAsset({ tag_name: 'v1.3.1', assets: [asset] }, false).id, 12);
  assert.throws(() => releaseAsset({ tag_name: 'v1.3.1', assets: [{ ...asset, digest: null }] }, false), /checksum/i);
});
test('private updater downloads verified bytes without forwarding credentials to asset storage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-update-'));
  const bytes = Buffer.from('fixture installer');
  const asset = { name: 'ArmaHost.Desktop.Setup.1.3.1.exe', id: 12, size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
  let storageHeaders;
  const updater = new DesktopUpdater({ version: '1.3.0', dir, fetcher: async (url, options) => {
    if (String(url).endsWith('/latest')) return Response.json({ tag_name: 'v1.3.1', assets: [asset] });
    if (String(url).includes('/assets/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixture' } });
    storageHeaders = options.headers;
    return new Response(bytes);
  } });
  try {
    assert.equal((await updater.check('session-token')).available, true);
    assert.deepEqual(await readFile(await updater.download()), bytes);
    assert.equal(storageHeaders, undefined);
    asset.digest = 'sha256:' + '0'.repeat(64);
    await updater.check('session-token');
    await assert.rejects(updater.download(), /checksum/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import { UpdateService, installPlan, releaseNotes } from '../desktop/updater.mjs';
import { writeFile, readdir } from 'node:fs/promises';
function fakeRelease({ version = '1.5.1', bytes = Buffer.from('new installer'), portable = false, body = 'Notes' } = {}) {
  const name = portable ? `ArmaHost-Desktop-Portable-${version}.exe` : `ArmaHost.Desktop.Setup.${version}.exe`;
  const asset = { name, id: 7, size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
  let downloads = 0;
  const fetcher = async url => {
    if (String(url).endsWith('/latest')) return Response.json({ tag_name: `v${version}`, body, assets: [asset] });
    if (String(url).includes('/assets/')) { downloads++; return new Response(bytes); }
    throw new Error('unexpected ' + url);
  };
  return { asset, fetcher, bytes, downloads: () => downloads };
}
async function service(t, release, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-upsvc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const updater = new DesktopUpdater({ version: '1.5.0', dir: path.join(dir, 'updates'), fetcher: release.fetcher, portable: options.portable });
  const timers = { pending: [], setTimeout(fn, ms) { const t = { fn, ms }; this.pending.push(t); return t; }, clearTimeout(t) { timers.pending = timers.pending.filter(x => x !== t); } };
  const svc = new UpdateService({ updater, stateFile: path.join(dir, 'updates', 'state.json'), timers, ...options.service });
  await svc.load();
  return { svc, dir, timers, updater };
}

test('background update: newer release downloads with progress, verifies, then reports ready', async t => {
  const release = fakeRelease({ body: 'Fixed things\r\n' + 'x'.repeat(5000) });
  const { svc } = await service(t, release);
  const seen = []; svc.onState(s => seen.push(s.status));
  const state = await svc.check();
  assert.equal(state.status, 'ready'); assert.equal(state.available, '1.5.1');
  assert.deepEqual(await readFile(state.file), release.bytes);
  assert.ok(seen.includes('checking') && seen.includes('downloading'));
  assert.equal(state.received, state.total);
  assert.ok(state.notes.length <= 4096 && !state.notes.includes('\r'));
  assert.equal((await svc.check()).status, 'ready'); assert.equal(release.downloads(), 1, 'ready is not re-downloaded');
});

test('up-to-date, skipped versions and checksum failures never report ready', async t => {
  const same = fakeRelease({ version: '1.5.0' });
  assert.equal((await (await service(t, same)).svc.check()).status, 'upToDate');
  const newer = fakeRelease();
  const { svc } = await service(t, newer);
  await svc.skip('1.5.1');
  assert.equal((await svc.check({ automatic: true })).status, 'skipped'); assert.equal(newer.downloads(), 0);
  assert.equal((await svc.check()).status, 'ready', 'Check now still offers a skipped version');
  const bad = fakeRelease(); bad.asset.digest = 'sha256:' + '0'.repeat(64);
  const broken = await service(t, bad);
  const state = await broken.svc.check();
  assert.equal(state.status, 'error'); assert.match(state.error, /checksum/i);
  assert.deepEqual((await readdir(broken.updater.dir)).filter(n => n.endsWith('.exe')), []);
});

test('a verified file already on disk is reused, and old downloads are cleaned up', async t => {
  const release = fakeRelease();
  const { svc, updater } = await service(t, release);
  await mkdir(updater.dir, { recursive: true });
  await writeFile(path.join(updater.dir, release.asset.name), release.bytes);
  await writeFile(path.join(updater.dir, 'ArmaHost.Desktop.Setup.1.4.1.exe'), 'old');
  await writeFile(path.join(updater.dir, 'unrelated.txt'), 'keep');
  assert.equal((await svc.check()).status, 'ready');
  assert.equal(release.downloads(), 0);
  assert.deepEqual((await readdir(updater.dir)).sort(), [release.asset.name, 'unrelated.txt'].sort());
});

test('scheduling: first check after a delay, then repeating; auto-check off stops it and persists', async t => {
  const release = fakeRelease({ version: '1.5.0' });
  const { svc, timers, dir } = await service(t, release, { service: { firstDelayMs: 15000, intervalMs: 3600000 } });
  svc.start();
  assert.equal(timers.pending.length, 1); assert.equal(timers.pending[0].ms, 15000);
  const first = timers.pending.shift(); first.fn(); await svc.running; await new Promise(r => setImmediate(r));
  assert.equal(timers.pending.length, 1); assert.equal(timers.pending[0].ms, 3600000);
  await svc.setAutoCheck(false);
  assert.equal(timers.pending.length, 0);
  const reloaded = new UpdateService({ updater: svc.updater, stateFile: path.join(dir, 'updates', 'state.json'), timers });
  await reloaded.load(); assert.equal(reloaded.state.autoCheck, false);
  reloaded.start(); assert.equal(timers.pending.length, 0);
});

test('concurrent checks share one run', async t => {
  const release = fakeRelease();
  const { svc } = await service(t, release);
  const [a, b] = await Promise.all([svc.check(), svc.check()]);
  assert.equal(a, b); assert.equal(release.downloads(), 1);
});

test('install plan: silent NSIS update with relaunch, or start the new portable exe', () => {
  assert.deepEqual(installPlan({ file: 'C:/u/ArmaHost.Desktop.Setup.1.5.1.exe', portable: false }), { command: 'C:/u/ArmaHost.Desktop.Setup.1.5.1.exe', args: ['/S', '--force-run'], kind: 'installer' });
  assert.deepEqual(installPlan({ file: 'D:/Tools/ArmaHost-Desktop-Portable-1.5.1.exe', portable: true }), { command: 'D:/Tools/ArmaHost-Desktop-Portable-1.5.1.exe', args: [], kind: 'portable' });
  assert.equal(releaseNotes('a\u0000b\r\nc'), 'ab\nc');
});

test('portable updates download next to the running portable executable', async t => {
  const release = fakeRelease({ portable: true });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-portable-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const updater = new DesktopUpdater({ version: '1.5.0', dir: path.join(dir, 'updates'), fetcher: release.fetcher, portable: true });
  const svc = new UpdateService({ updater, stateFile: path.join(dir, 'updates', 'state.json'), downloadDir: path.join(dir, 'Tools') });
  const state = await svc.check();
  assert.equal(state.file, path.join(dir, 'Tools', 'ArmaHost-Desktop-Portable-1.5.1.exe'));
});
