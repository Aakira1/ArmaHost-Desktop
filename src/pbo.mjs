import { createHash } from 'node:crypto';

// Minimal uncompressed PBO writer (the Arma addon archive format).
// Layout: version entry + header extensions, file entries, empty terminator entry, file data,
// then a zero byte followed by the SHA-1 of everything before it.
const zstring = text => Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0])]);
function entry(name, { method = 0, originalSize = 0, timestamp = 0, dataSize = 0 } = {}) {
  const fields = Buffer.alloc(20);
  fields.writeUInt32LE(method, 0); fields.writeUInt32LE(originalSize, 4); fields.writeUInt32LE(0, 8);
  fields.writeUInt32LE(timestamp, 12); fields.writeUInt32LE(dataSize, 16);
  return Buffer.concat([zstring(name), fields]);
}
export function packPbo(files, { prefix, timestamp = 0 } = {}) {
  if (!prefix || /[\\/\0]/.test(prefix)) throw new Error('PBO prefix must be a plain folder name.');
  const list = Object.entries(files).map(([name, content]) => {
    if (!/^[A-Za-z0-9_.]+(?:\\[A-Za-z0-9_.]+)*$/.test(name)) throw new Error(`Invalid PBO entry name: ${name}`);
    return [name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')];
  }).sort(([a], [b]) => a.localeCompare(b));
  const parts = [entry('', { method: 0x56657273 }), zstring('prefix'), zstring(prefix), zstring('')];
  for (const [name, data] of list) parts.push(entry(name, { originalSize: data.length, timestamp, dataSize: data.length }));
  parts.push(entry(''));
  for (const [, data] of list) parts.push(data);
  const body = Buffer.concat(parts);
  return Buffer.concat([body, Buffer.from([0]), createHash('sha1').update(body).digest()]);
}
// Reader used by tests to prove the archive round-trips.
export function readPbo(buffer) {
  let offset = 0;
  const zs = () => { const end = buffer.indexOf(0, offset); const value = buffer.toString('utf8', offset, end); offset = end + 1; return value; };
  const header = () => { const name = zs(); const h = { name, method: buffer.readUInt32LE(offset), dataSize: buffer.readUInt32LE(offset + 16) }; offset += 20; return h; };
  const first = header(); if (first.method !== 0x56657273) throw new Error('Missing PBO version entry.');
  const extensions = {}; for (let key = zs(); key; key = zs()) extensions[key] = zs();
  const entries = []; for (let h = header(); h.name; h = header()) entries.push(h);
  const files = {};
  for (const h of entries) { files[h.name] = buffer.subarray(offset, offset + h.dataSize).toString('utf8'); offset += h.dataSize; }
  if (buffer[offset] !== 0) throw new Error('Missing PBO checksum marker.');
  const checksum = buffer.subarray(offset + 1, offset + 21);
  const valid = createHash('sha1').update(buffer.subarray(0, offset)).digest().equals(checksum) && offset + 21 === buffer.length;
  return { extensions, files, valid };
}
