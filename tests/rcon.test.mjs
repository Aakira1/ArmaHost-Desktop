import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { RconClient, encodePacket, decodePacket, parsePlayers, crc32 } from '../src/rcon.mjs';
import { defaults, validateSettings, renderBattleye, serverArgs } from '../src/config.mjs';
import { LiveMonitor } from '../src/live-monitor.mjs';
import { LogBook } from '../src/logs.mjs';
import { createApp } from '../src/http.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

test('RCon validates settings, keeps credentials out of argv and binds management to loopback', () => {
  const s = validateSettings({ ...defaults(), rconEnabled: true, rconPassword: 'test-rcon-secret' });
  assert.match(renderBattleye(s), /RConIP 127\.0\.0\.1/);
  assert.match(renderBattleye(s), /RConPort 2307/);
  const args = serverArgs(s, { configFile: 'config', profilesDir: 'profiles', battleyeDir: 'be' });
  assert.ok(args.includes('-BEpath=be'));
  assert.ok(!args.join(' ').includes(s.rconPassword));
  for (const changes of [{ rconPort: 2302 }, { rconPort: 2306 }, { rconPort: '2307' }, { rconPassword: '' }, { rconPassword: 'secret\ncommand' }, { battleye: false }]) assert.throws(() => validateSettings({ ...s, ...changes }));
  assert.equal(validateSettings({ serverName: 'Legacy' }).rconEnabled, false);
});
test('packet framing checks the standard CRC32 vector and rejects corrupt packets', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const packet = encodePacket(Buffer.from([1, 3, 65]));
  assert.deepEqual(decodePacket(packet), Buffer.from([1, 3, 65]));
  packet[8] ^= 1;
  assert.equal(decodePacket(packet), null);
  assert.equal(decodePacket(Buffer.from('garbage')), null);
});
test('players parser handles spaces, lobby suffixes and explicit empty lists without trusting malformed responses', () => {
  const text = 'Players on server:\n[#] [IP Address]:[Port] [Ping] [GUID] [Name]\n0 100.101.2.3:2304 42 0123456789abcdef0123456789abcdef(OK) Friend One (Lobby)\n1 192.168.1.5:2304 0 -(?) Other Player\n(2 players in total)';
  const players = parsePlayers(text);
  assert.equal(players[0].name, 'Friend One (Lobby)'); assert.equal(players[0].ping, 42);
  assert.equal(players[1].id, 1);
  assert.deepEqual(parsePlayers('Players on server:\n(0 players in total)'), []);
  assert.throws(() => parsePlayers('Unknown command'), /player list/i);
});
async function fakeServer(fn, rejectLogin = false) {
  const server = dgram.createSocket('udp4');
  await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
  const commands = []; let acknowledged = false;
  server.on('message', (data, peer) => {
    const p = decodePacket(data); if (!p) return;
    const send = payload => server.send(encodePacket(Buffer.from(payload)), peer.port, peer.address);
    if (p[0] === 0) send([0, rejectLogin ? 0 : 1]);
    if (p[0] === 2) acknowledged = true;
    if (p[0] === 1) {
      const command = p.subarray(2).toString(); commands.push(command);
      if (command === 'players') {
        const parts = ['Players on server:\n0 100.101.2.3:2304 22 ', '0123456789abcdef0123456789abcdef(OK) Friend\n(1 players in total)'];
        send(Buffer.concat([Buffer.from([1, p[1], 0, 2, 1]), Buffer.from(parts[1])]));
        send(Buffer.concat([Buffer.from([1, p[1], 0, 2, 0]), Buffer.from(parts[0])]));
        send(Buffer.concat([Buffer.from([2, 9]), Buffer.from('Player #0 Friend connected')]));
      } else if ((command.startsWith('say -1 ') && command !== 'say -1 ignored') || command === '#shutdown') send([1, p[1]]);
    }
  });
  const client = new RconClient({ port: server.address().port, password: 'test-rcon-secret', timeout: 150 });
  try { await fn(client, commands, () => acknowledged); }
  finally { client.close(); await new Promise(resolve => server.close(resolve)); }
}
test('closing a client cancels queued broadcasts before they can reconnect', async () => fakeServer(async (client, commands) => {
  const pending = client.command('say -1 old session');
  client.close();
  await assert.rejects(pending, /closed/i);
  assert.deepEqual(commands, []);
  assert.equal(client.ready, false);
}));
test('UDP client authenticates, reassembles out-of-order replies and acknowledges server events', async () => fakeServer(async (client, commands, acknowledged) => {
  const response = await client.command('players');
  assert.equal(parsePlayers(response)[0].name, 'Friend');
  await client.command('say -1 ArmaHost connection test');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(acknowledged()); assert.equal(commands.length, 2);
  await assert.rejects(client.command('#shutdown'), /not allowed/i);
}));
test('UDP login rejection and response timeout fail clearly and release the connection', async () => {
  await fakeServer(async client => { await assert.rejects(client.command('players'), /password|login/i); }, true);
  await fakeServer(async client => { await assert.rejects(client.command('say -1 ignored'), /timeout/i); });
});
test('live monitor records present/join/leave observations, keeps stale rows on failure and clears stopped sessions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-monitor-'));
  const logs = new LogBook(dir);
  const manager = { child: {}, demo: false, activeSettings: { ...defaults(), rconEnabled: true, rconPassword: 'monitor-secret' } };
  let reply = 'Players on server:\n0 100.101.2.3:2304 22 abc(OK) Friend\n(1 players in total)';
  const monitor = new LiveMonitor(manager, logs, () => ({ close() {}, command: async () => { if (reply instanceof Error) throw reply; return reply; } }));
  try {
    assert.equal((await monitor.refresh()).players[0].name, 'Friend');
    reply = 'Players on server:\n1 100.101.2.4:2304 30 def(OK) Second Friend\n(1 players in total)';
    const changed = await monitor.refresh();
    assert.ok(changed.events.some(e => e.type === 'joined'));
    assert.ok(changed.events.some(e => e.type === 'left'));
    reply = new Error('RCon unavailable');
    const stale = await monitor.refresh();
    assert.equal(stale.status, 'disconnected'); assert.equal(stale.players.length, 1);
    manager.child = null;
    assert.equal(monitor.snapshot().status, 'stopped'); assert.equal(monitor.snapshot().players.length, 0);
  } finally { monitor.close(); await rm(dir, { recursive: true, force: true }); }
});
test('late RCon response cannot mark a stopped server connected', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-monitor-'));
  const manager = { child: {}, demo: false, activeSettings: { ...defaults(), rconEnabled: true, rconPassword: 'monitor-secret' } };
  let resolve;
  const monitor = new LiveMonitor(manager, new LogBook(dir), () => ({ close() {}, command: () => new Promise(done => { resolve = done; }) }));
  try {
    const pending = monitor.refresh(); manager.child = null;
    resolve('Players on server:\n(0 players in total)');
    assert.equal((await pending).status, 'stopped');
  } finally { monitor.close(); await rm(dir, { recursive: true, force: true }); }
});
test('live API requires authentication, manages config and labels demo broadcasts without claiming delivery', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-rcon-api-'));
  const app = await createApp({ root: fileURLToPath(new URL('..', import.meta.url)), dir, port: 0, demo: true });
  const headers = { 'X-Arma-Token': app.token, 'Content-Type': 'application/json' };
  const post = (route, body = {}) => fetch(app.url + route, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(app.url + '/api/live')).status, 401);
    assert.equal((await post('/api/live/check')).status, 409);
    const settings = validateSettings({ ...defaults(), rconEnabled: true, rconPassword: 'private-rcon-password' });
    await app.store.saveSettings(settings, 0); await app.manager.start(settings);
    const cfg = await readFile(path.join(app.manager.battleyeDir, 'BEServer_x64.cfg'), 'utf8');
    assert.match(cfg, /RConIP 127\.0\.0\.1/);
    const result = await (await post('/api/live/check')).json();
    assert.equal(result.status, 'demo'); assert.deepEqual(result.players, []);
    assert.equal((await post('/api/live/message', { message: 'test\n#shutdown' })).status, 400);
    const message = await (await post('/api/live/message', { message: 'ArmaHost connection test' })).json();
    assert.equal(message.demo, true); assert.match(message.message, /no in-game message/);
    assert.equal((await post('/api/live/message', { message: 'repeat' })).status, 429);
    assert.ok(!app.logs.text().includes(settings.rconPassword));
    await app.manager.stop(); assert.equal(app.monitor.snapshot().status, 'stopped');
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('shutdown is a fixed internal command; arbitrary admin commands stay blocked', async () => fakeServer(async (client, commands) => {
  for (const command of ['#shutdown', '#exec ban 1', '#restart']) await assert.rejects(client.command(command), /not allowed/i);
  await client.shutdown();
  assert.deepEqual(commands, ['#shutdown']);
}));
