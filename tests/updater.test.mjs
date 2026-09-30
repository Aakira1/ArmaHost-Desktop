import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, releaseAsset, DesktopUpdater } from '../desktop/updater.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
