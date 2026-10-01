import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { lzo1xDecompress, decodeDxt, decodePaa, encodePng } from '../src/paa.mjs';
import { findGameFile } from '../src/arma-files.mjs';
import { packPbo } from '../src/pbo.mjs';
import { MapBackgrounds } from '../src/map-backgrounds.mjs';
import { LiveMap } from '../src/live-map.mjs';
import { feedScript } from '../src/map-addon.mjs';

// Synthetic 64x64 DXT5 texture: opaque, solid colour per block. LZO fixture below was produced from
// exactly these bytes with an independent LZO1X-1 compressor (the decoder was also cross-checked
// against it on 350 varied inputs during development).
function dxt5(width, height) {
  const blocks = [];
  for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
    const b = Buffer.alloc(16); b[0] = 255; b[1] = 255;
    const color = ((bx / 4) % 4) * 0x1f + (((by / 4) % 2) << 11); b.writeUInt16LE(color, 8); b.writeUInt16LE(color, 10);
    blocks.push(b);
  }
  return Buffer.concat(blocks);
}
const LZO_FIXTURE = Buffer.from('FP//ACsAAP8BHwAfnAL/AT4APis/AF0AXSs8AJABUAD8BSCQ/wAIAAhZFwAn/gIIHys/AD4IPis/AF0IXSs8AFQHKz0AHyCP/ABwH0wAJ/wDIAAAAAAAAAAAAAAAAAC//AcAAgAAAAD//wAAAAAAAF0IXQgAAAAAEQAA', 'base64');
function paa(mips, { format = 0xff05 } = {}) {
  const parts = [Buffer.from([format & 255, format >> 8])];
  const tagg = Buffer.alloc(16); tagg.write('GGATCGVA', 0, 'latin1'); tagg.writeUInt32LE(4, 8); parts.push(tagg);
  parts.push(Buffer.from([0, 0])); // empty palette
  for (const { width, height, data, lzo } of mips) {
    const h = Buffer.alloc(7); h.writeUInt16LE(width | (lzo ? 0x8000 : 0), 0); h.writeUInt16LE(height, 2); h.writeUIntLE(data.length, 4, 3);
    parts.push(h, data);
  }
  parts.push(Buffer.alloc(6));
  return Buffer.concat(parts);
}
const pixel = (img, x, y) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('LZO1X decompression reproduces the original texture bytes and rejects corrupt data', () => {
  const raw = dxt5(64, 64);
  const out = lzo1xDecompress(LZO_FIXTURE, raw.length);
  assert.equal(createHash('sha256').update(out).digest('hex'), '832c38234962f0721747bf5f410505ba3ad92dc7e6ede8a4e9266aafda7ac281');
  assert.ok(out.equals(raw));
  assert.throws(() => lzo1xDecompress(LZO_FIXTURE.subarray(0, 40), raw.length), /Corrupt/);
  assert.throws(() => lzo1xDecompress(LZO_FIXTURE, raw.length - 1), /Corrupt/);
});

test('DXT1 and DXT5 blocks decode to the expected colours and alpha', () => {
  const dxt1 = Buffer.alloc(8); dxt1.writeUInt16LE(0xf800, 0); dxt1.writeUInt16LE(0x001f, 2); dxt1.writeUInt32LE(0b01, 4); // pixel 0 = colour1 (blue)
  const img1 = { width: 4, height: 4, rgba: decodeDxt(dxt1, 4, 4, 'DXT1') };
  assert.deepEqual(pixel(img1, 0, 0), [0, 0, 255, 255]); assert.deepEqual(pixel(img1, 1, 0), [255, 0, 0, 255]);
  const dxt5b = Buffer.alloc(16); dxt5b[0] = 200; dxt5b[1] = 100; dxt5b[2] = 0b001; dxt5b.writeUInt16LE(0x07e0, 8); dxt5b.writeUInt16LE(0x07e0, 10);
  const img5 = { width: 4, height: 4, rgba: decodeDxt(dxt5b, 4, 4, 'DXT5') };
  assert.deepEqual(pixel(img5, 0, 0), [0, 255, 0, 100]); assert.deepEqual(pixel(img5, 1, 0), [0, 255, 0, 200]);
  assert.throws(() => decodeDxt(Buffer.alloc(4), 4, 4, 'DXT1'), /truncated/);
});

test('PAA: skips tags, picks the largest mip within the size limit, and decodes LZO mips', () => {
  const big = dxt5(128, 128);
  const file = paa([{ width: 128, height: 128, data: big }, { width: 64, height: 64, data: LZO_FIXTURE, lzo: true }]);
  const small = decodePaa(file, { maxSize: 64 });
  assert.equal(small.width, 64); assert.equal(small.height, 64);
  assert.deepEqual(pixel(small, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(small, 4, 0), [0, 0, 255, 255]);         // colour 0x001f = blue
  assert.deepEqual(pixel(small, 0, 4), [8, 0, 0, 255]);           // 1 << 11 = dark red
  assert.equal(decodePaa(file, { maxSize: 2048 }).width, 128);
  assert.throws(() => decodePaa(paa([{ width: 4, height: 4, data: Buffer.alloc(16) }], { format: 0x4444 })), /Unsupported/);
  assert.throws(() => decodePaa(Buffer.from('nope')), /Not a PAA/);
});

test('PNG encoder writes a valid RGBA image', () => {
  const png = encodePng({ width: 2, height: 1, rgba: Buffer.from([255, 0, 0, 255, 0, 0, 255, 128]) });
  assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.equal(png.readUInt32BE(16), 2); assert.equal(png.readUInt32BE(20), 1);
  const idatLen = png.readUInt32BE(33); const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.deepEqual([...raw], [0, 255, 0, 0, 255, 0, 0, 255, 128]);
});

async function fakeInstall(dir) {
  const game = path.join(dir, 'Arma 3');
  await mkdir(path.join(game, 'Addons'), { recursive: true }); await mkdir(path.join(game, 'Expansion', 'Addons'), { recursive: true }); await mkdir(path.join(game, '!Workshop', 'Addons'), { recursive: true });
  await writeFile(path.join(game, 'Addons', 'other.pbo'), packPbo({ 'config.cpp': 'x' }, { prefix: 'a3\\other' }));
  const texture = paa([{ width: 64, height: 64, data: LZO_FIXTURE, lzo: true }]);
  await writeFile(path.join(game, 'Expansion', 'Addons', 'map_test.pbo'), packPbo({ 'config.cpp': 'class CfgWorlds {};', 'data\\pictureMap_ca.paa': texture }, { prefix: 'a3\\map_test' }));
  await writeFile(path.join(game, '!Workshop', 'Addons', 'map_workshop.pbo'), packPbo({ 'data\\pictureMap_ca.paa': texture }, { prefix: 'a3\\map_ws' }));
  return { game, texture };
}

test('game files: the pictureMap is found by its in-game path inside installed PBOs (DLC folders included)', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-files-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { game, texture } = await fakeInstall(dir);
  const found = await findGameFile('\\A3\\Map_Test\\Data\\PictureMap_CA.paa', [game]);
  assert.ok(found.data.equals(texture)); assert.match(found.pbo, /map_test\.pbo$/);
  assert.equal(await findGameFile('a3\\map_missing\\data\\picturemap_ca.paa', [game]), null);
  assert.equal(await findGameFile('a3\\map_ws\\data\\picturemap_ca.paa', [game]), null, '!Workshop junctions are not scanned');
  await assert.rejects(findGameFile('a3\\..\\..\\secret.paa', [game]), /Invalid/);
});

test('terrain map is extracted automatically, cached, and a user image still takes priority', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-bg-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { game } = await fakeInstall(dir);
  const backgrounds = new MapBackgrounds(path.join(dir, 'data'));
  assert.deepEqual(await backgrounds.status('Test'), { source: null, status: 'none' });
  const pending = backgrounds.ensureAuto('Test', 'a3\\map_test\\data\\pictureMap_ca.paa', [game, null]);
  assert.equal((await backgrounds.status('Test')).status, 'extracting');
  await pending;
  assert.deepEqual(await backgrounds.status('Test'), { source: 'game', status: 'ready', error: '', from: 'map_test.pbo' });
  const image = await backgrounds.get('Test');
  assert.equal(image.source, 'game'); assert.equal(image.data.readUInt32BE(16), 64);
  const missing = await backgrounds.ensureAuto('Nowhere', 'a3\\map_nowhere\\data\\pictureMap_ca.paa', [game]);
  assert.equal(missing.status, 'failed'); assert.match(missing.error, /Couldn't find/);
  const png = path.join(dir, 'mine.png'); await writeFile(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]));
  await backgrounds.set('Test', png);
  assert.equal((await backgrounds.get('Test')).source, 'user'); assert.equal((await backgrounds.status('Test')).source, 'user');
  await backgrounds.clear('Test');
  assert.equal((await backgrounds.get('Test')).source, 'game', 'removing your image falls back to the terrain map');
});

test('the server feed reports the terrain pictureMap, and only safe paths are accepted', () => {
  assert.match(feedScript(3), /getText \(configFile >> "CfgWorlds" >> worldName >> "pictureMap"\)/);
  const map = new LiveMap();
  for (const line of ['AHMAP|F|1|0|Altis|30720|3|A3\\map_Altis\\data\\pictureMap_ca.paa', 'AHMAP|E|1|0|0|0']) map.ingest(line);
  assert.equal(map.snapshot({ running: true, enabled: true }).frame.pictureMap, 'A3\\map_Altis\\data\\pictureMap_ca.paa');
  for (const bad of ['..\\..\\x.paa', 'C:\\Windows\\x.paa', 'a3\\x.png', 'http://x/y.paa']) {
    const m = new LiveMap(); for (const line of [`AHMAP|F|1|0|Altis|30720|3|${bad}`, 'AHMAP|E|1|0|0|0']) m.ingest(line);
    assert.equal(m.snapshot({ running: true, enabled: true }).frame.pictureMap, '', bad);
  }
  const old = new LiveMap(); for (const line of ['AHMAP|F|1|0|Altis|30720|3', 'AHMAP|E|1|0|0|0']) old.ingest(line);
  assert.equal(old.snapshot({ running: true, enabled: true }).frame.pictureMap, '', 'older feeds without the field still work');
});
