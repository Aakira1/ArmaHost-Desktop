import dgram from 'node:dgram';

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function encodePacket(payload) {
  const packet = Buffer.concat([Buffer.from([66, 69, 0, 0, 0, 0, 255]), payload]);
  packet.writeUInt32LE(crc32(packet.subarray(6)), 2);
  return packet;
}
export function decodePacket(packet) {
  if (packet.length < 8 || packet[0] !== 66 || packet[1] !== 69 || packet[6] !== 255 || packet.readUInt32LE(2) !== crc32(packet.subarray(6))) return null;
  return packet.subarray(7);
}
export function parsePlayers(text) {
  if (!/Players on server:/i.test(text)) throw new Error('RCon did not return a recognised player list.');
  const players = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (match) players.push({ id: Number(match[1]), address: match[2], ping: Number(match[3]), guid: match[4], name: match[5].trim() });
  }
  const count = text.match(/\((\d+) players? in total\)/i);
  if (!count || Number(count[1]) !== players.length) throw new Error('RCon player list was incomplete or could not be parsed.');
  return players;
}

// Only the local managed server is accessible. No arbitrary RCon commands are exposed.
export class RconClient {
  constructor({ port, password, timeout = 3000, onMessage = () => {} }) {
    this.port = port; this.password = password; this.timeout = timeout; this.onMessage = onMessage;
    this.socket = null; this.ready = false; this.sequence = 0; this.pending = null; this.queue = Promise.resolve();
    this.seen = new Set(); this.closed = false;
  }
  command(command) {
    if (command !== 'players' && !/^say -1 [\x20-\x7e]{1,200}$/.test(command)) return Promise.reject(new Error('RCon command is not allowed.'));
    return this.run(command);
  }
  // Fixed internal command used only by Stop Server; never reachable through command().
  shutdown() { return this.run('#shutdown'); }
  run(command) {
    const task = this.queue.then(async () => {
      if (this.closed) throw new Error('RCon connection closed.');
      if (!this.ready) await this.connect();
      if (this.closed) throw new Error('RCon connection closed.');
      const seq = this.sequence++ & 255;
      return this.request(Buffer.concat([Buffer.from([1, seq]), Buffer.from(command, 'ascii')]), 1, seq);
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async connect() {
    this.resetTransport();
    this.seen.clear();
    const socket = dgram.createSocket('udp4'); this.socket = socket;
    socket.on('error', () => this.resetTransport(new Error('RCon socket failed. Check BattlEye and the configured port.')));
    socket.on('message', data => { if (this.socket === socket && !this.closed) this.receive(data); });
    await new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Could not connect to local RCon.'));
      socket.once('error', fail);
      socket.once('close', fail);
      socket.connect(this.port, '127.0.0.1', () => { socket.off('error', fail); resolve(); });
    });
    if (this.closed || this.socket !== socket) throw new Error('RCon connection closed.');
    await this.request(Buffer.concat([Buffer.from([0]), Buffer.from(this.password, 'ascii')]), 0);
    this.ready = true;
  }
  request(payload, type, sequence = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.resetTransport(new Error('RCon timeout. Confirm BattlEye is enabled and restart after saving RCon settings.')), this.timeout);
      this.pending = { resolve, reject, timer, type, sequence, parts: new Map(), total: null, bytes: 0 };
      this.send(payload);
    });
  }
  send(payload) {
    if (!this.socket) return;
    this.socket.send(encodePacket(payload), error => { if (error) this.resetTransport(new Error('Could not send to local RCon.')); });
  }
  receive(data) {
    const p = decodePacket(data); if (!p) return;
    if (p[0] === 2 && p.length >= 2 && this.ready) {
      this.send(Buffer.from([2, p[1]]));
      const key = p[1] + ':' + p.subarray(2).toString('hex');
      if (!this.seen.has(key)) { this.seen.add(key); if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value); this.onMessage(p.subarray(2).toString('latin1')); }
      return;
    }
    const pending = this.pending;
    if (!pending || p[0] !== pending.type) return;
    if (p[0] === 0) {
      if (p.length !== 2) return;
      if (p[1] !== 1) { this.resetTransport(new Error('RCon login rejected. Check the RCon password and restart the server.')); return; }
      this.finish(''); return;
    }
    if (p.length < 2 || p[1] !== pending.sequence) return;
    const body = p.subarray(2);
    if (body.length && body[0] === 0) {
      if (body.length < 3 || !body[1] || body[2] >= body[1]) return;
      if (pending.total !== null && pending.total !== body[1]) return;
      pending.total = body[1];
      if (!pending.parts.has(body[2])) { pending.parts.set(body[2], body.subarray(3)); pending.bytes += body.length - 3; }
      if (pending.bytes > 131072) { this.resetTransport(new Error('RCon response exceeded the size limit.')); return; }
      if (pending.parts.size === pending.total) this.finish(Buffer.concat(Array.from({ length: pending.total }, (_, i) => pending.parts.get(i))).toString('latin1'));
    } else this.finish(body.toString('latin1'));
  }
  finish(value) {
    const pending = this.pending; this.pending = null;
    clearTimeout(pending.timer); pending.resolve(value);
  }
  close(error = new Error('RCon connection closed.')) {
    this.closed = true; this.resetTransport(error);
  }
  resetTransport(error = new Error('RCon connection closed.')) {
    this.ready = false;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    const socket = this.socket; this.socket = null;
    if (socket) { try { socket.close(); } catch {} }
  }
}
