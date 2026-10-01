import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { queryServer, parseInfo } from '../src/query.mjs';

const header = Buffer.from([0xff, 0xff, 0xff, 0xff]);
function infoReply() {
  const s = text => Buffer.from(text + '\0', 'utf8');
  return Buffer.concat([header, Buffer.from([0x49, 17]), s('Arma Ops'), s('Altis'), s('Arma3'), s('Arma 3'), Buffer.from([0, 0, 2, 16, 0, 0x64, 0x77, 0, 0]), s('2.18')]);
}
test('A2S_INFO parsing reads name, map and player counts and rejects other packets', () => {
  const info = parseInfo(infoReply());
  assert.deepEqual([info.name, info.map, info.players, info.maxPlayers, info.version], ['Arma Ops', 'Altis', 2, 16, '2.18']);
  assert.equal(parseInfo(Buffer.from('garbage')), null);
});
test('query answers the challenge handshake and times out cleanly with no server', async () => {
  const server = dgram.createSocket('udp4'); const seen = [];
  await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
  server.on('message', (data, peer) => {
    seen.push(data.length);
    const reply = data.length === 25 ? Buffer.concat([header, Buffer.from([0x41, 1, 2, 3, 4])]) : infoReply();
    server.send(reply, peer.port, peer.address);
  });
  try {
    const info = await queryServer('127.0.0.1', server.address().port, { timeout: 500 });
    assert.equal(info.name, 'Arma Ops'); assert.deepEqual(seen, [25, 29]);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const silent = dgram.createSocket('udp4'); await new Promise(resolve => silent.bind(0, '127.0.0.1', resolve));
  const port = silent.address().port;
  try { await assert.rejects(queryServer('127.0.0.1', port, { timeout: 60, attempts: 2 }), /No reply/); }
  finally { await new Promise(resolve => silent.close(resolve)); }
});
