import { deflateSync } from 'node:zlib';

// Decoder for Arma's PAA textures (DXT1/DXT5, optionally LZO-compressed), used to turn a terrain's
// pictureMap from the user's own installation into a PNG for the Live map. Input is treated as untrusted.

// LZO1X decompression (the format used for compressed PAA mipmaps). Output size is known up front.
export function lzo1xDecompress(input, outputSize) {
  const out = Buffer.alloc(outputSize);
  let ip = 0, op = 0, t, mPos;
  const fail = () => { throw new Error('Corrupt LZO data in texture.'); };
  const byte = () => { if (ip >= input.length) fail(); return input[ip++]; };
  const literals = n => { if (ip + n > input.length || op + n > out.length) fail(); input.copy(out, op, ip, ip + n); ip += n; op += n; };
  const copyMatch = (from, n) => { if (from < 0 || op + n > out.length) fail(); for (let i = 0; i < n; i++) out[op++] = out[from + i]; };
  const length = (base, mask) => { let n = t & mask; if (n === 0) { while (input[ip] === 0) { n += 255; ip++; if (ip >= input.length) fail(); } n += base + byte(); } return n; };
  let state = 'start';
  if (input[0] > 17) {
    t = byte() - 17;
    if (t < 4) { literals(t); t = byte(); state = 'match'; }
    else { literals(t); state = 'first'; }
  }
  for (;;) {
    if (state === 'start') {
      t = byte();
      if (t >= 16) state = 'match';
      else {
        if (t === 0) { t = 15; while (input[ip] === 0) { t += 255; ip++; if (ip >= input.length) fail(); } t += byte(); }
        literals(t + 3); state = 'first';
      }
    }
    if (state === 'first') {
      t = byte();
      if (t >= 16) state = 'match';
      else {
        mPos = op - 0x801 - (t >> 2) - (byte() << 2);
        copyMatch(mPos, 3);
        state = 'done';
      }
    }
    if (state === 'match') {
      if (t >= 64) {
        mPos = op - 1 - ((t >> 2) & 7) - (byte() << 3);
        copyMatch(mPos, (t >> 5) + 1);
      } else if (t >= 32) {
        const n = length(31, 31);
        const lo = byte(), hi = byte();
        mPos = op - 1 - ((lo >> 2) + (hi << 6));
        copyMatch(mPos, n + 2);
      } else if (t >= 16) {
        const high = (t & 8) << 11;
        const n = length(7, 7);
        const lo = byte(), hi = byte();
        mPos = op - high - ((lo >> 2) + (hi << 6));
        if (mPos === op) { if (op !== out.length) fail(); return out; } // end-of-stream marker
        copyMatch(mPos - 0x4000, n + 2);
      } else {
        mPos = op - 1 - (t >> 2) - (byte() << 2);
        copyMatch(mPos, 2);
      }
      state = 'done';
    }
    if (state === 'done') {
      t = input[ip - 2] & 3;
      if (t === 0) { state = 'start'; continue; }
      literals(t); t = byte(); state = 'match';
    }
  }
}

const rgb565 = c => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
function colorBlock(data, at, out, x0, y0, width, height, dxt1) {
  const c0 = data.readUInt16LE(at), c1 = data.readUInt16LE(at + 2), bits = data.readUInt32LE(at + 4);
  const a = rgb565(c0), b = rgb565(c1);
  const palette = [[...a, 255], [...b, 255]];
  if (!dxt1 || c0 > c1) { palette.push([0, 1, 2].map(i => (2 * a[i] + b[i]) / 3 | 0).concat(255), [0, 1, 2].map(i => (a[i] + 2 * b[i]) / 3 | 0).concat(255)); }
  else { palette.push([0, 1, 2].map(i => (a[i] + b[i]) / 2 | 0).concat(255), [0, 0, 0, 0]); }
  for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
    const x = x0 + px, y = y0 + py; if (x >= width || y >= height) continue;
    const c = palette[(bits >>> (2 * (py * 4 + px))) & 3]; const o = (y * width + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
  }
}
function alphaBlock(data, at, out, x0, y0, width, height) {
  const a0 = data[at], a1 = data[at + 1];
  const alphas = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) alphas.push(((7 - i) * a0 + i * a1) / 7 | 0);
  else { for (let i = 1; i < 5; i++) alphas.push(((5 - i) * a0 + i * a1) / 5 | 0); alphas.push(0, 255); }
  // 48 bits of 3-bit indices, split into two 24-bit halves (pixels 0-7 and 8-15).
  const lo = data[at + 2] | (data[at + 3] << 8) | (data[at + 4] << 16), hi = data[at + 5] | (data[at + 6] << 8) | (data[at + 7] << 16);
  for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
    const x = x0 + px, y = y0 + py; if (x >= width || y >= height) continue;
    const i = py * 4 + px;
    out[(y * width + x) * 4 + 3] = alphas[((i < 8 ? lo : hi) >> (3 * (i & 7))) & 7];
  }
}
export function decodeDxt(data, width, height, format) {
  const blockSize = format === 'DXT1' ? 8 : 16;
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
  if (data.length < blocks * blockSize) throw new Error('Texture data is truncated.');
  const out = Buffer.alloc(width * height * 4);
  let at = 0;
  for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
    if (format === 'DXT5') { colorBlock(data, at + 8, out, bx, by, width, height, false); alphaBlock(data, at, out, bx, by, width, height); }
    else colorBlock(data, at, out, bx, by, width, height, true);
    at += blockSize;
  }
  return out;
}

const FORMATS = { 0xff01: 'DXT1', 0xff05: 'DXT5' };
// Returns { width, height, rgba } for the largest mipmap no bigger than maxSize.
export function decodePaa(buffer, { maxSize = 2048 } = {}) {
  if (buffer.length < 8) throw new Error('Not a PAA texture.');
  const format = FORMATS[buffer.readUInt16LE(0)];
  if (!format) throw new Error(`Unsupported PAA texture format 0x${buffer.readUInt16LE(0).toString(16)}.`);
  let at = 2;
  while (buffer.toString('latin1', at, at + 4) === 'GGAT') { const size = buffer.readUInt32LE(at + 8); at += 12 + size; }
  const palette = buffer.readUInt16LE(at); at += 2 + palette * 3;
  const mips = [];
  while (at + 4 <= buffer.length) {
    let width = buffer.readUInt16LE(at), height = buffer.readUInt16LE(at + 2);
    if (width === 0 || height === 0) break;
    const size = buffer.readUIntLE(at + 4, 3); at += 7;
    const lzo = (width & 0x8000) !== 0; width &= 0x7fff;
    if (at + size > buffer.length) throw new Error('PAA texture is truncated.');
    mips.push({ width, height, lzo, data: buffer.subarray(at, at + size) }); at += size;
  }
  const mip = mips.find(m => m.width <= maxSize && m.height <= maxSize);
  if (!mip) throw new Error('PAA texture has no usable mipmap.');
  const expected = Math.ceil(mip.width / 4) * Math.ceil(mip.height / 4) * (format === 'DXT1' ? 8 : 16);
  const data = mip.lzo ? lzo1xDecompress(mip.data, expected) : mip.data;
  return { width: mip.width, height: mip.height, rgba: decodeDxt(data, mip.width, mip.height, format) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
export function encodePng({ width, height, rgba }) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
