import dgram from 'node:dgram';

// Steam A2S_INFO: the same query the in-game server browser uses. Arma 3 answers on game port + 1.
const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const REQUEST = Buffer.concat([HEADER, Buffer.from('TSource Engine Query\0', 'latin1')]);

export function parseInfo(packet) {
  if (packet.length < 6 || !packet.subarray(0, 4).equals(HEADER) || packet[4] !== 0x49) return null;
  let offset = 6; // header, type, protocol
  const string = () => { const end = packet.indexOf(0, offset); if (end < 0) throw new Error('Truncated server reply.'); const value = packet.toString('utf8', offset, end); offset = end + 1; return value; };
  const name = string(), map = string(), folder = string(), game = string();
  offset += 2; // Steam app id
  if (offset + 3 > packet.length) throw new Error('Truncated server reply.');
  const players = packet[offset], maxPlayers = packet[offset + 1];
  offset += 3; // players, max, bots
  offset += 4; // server type, environment, visibility, VAC
  let version = '';
  try { version = string(); } catch { /* Older replies may stop early. */ }
  return { name, map, folder, game, players, maxPlayers, version };
}

export function queryServer(host, port, { timeout = 2500, attempts = 2 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const started = Date.now(); let tries = 0; let timer;
    const finish = (error, value) => { clearTimeout(timer); try { socket.close(); } catch { /* Already closed. */ } error ? reject(error) : resolve(value); };
    const send = payload => {
      socket.send(payload, port, host, error => { if (error) finish(new Error(`Could not send the query: ${error.message}`)); });
      clearTimeout(timer);
      timer = setTimeout(() => { if (++tries < attempts) send(payload); else finish(new Error(`No reply from ${host}:${port} within ${Math.round(timeout * attempts / 1000)} s.`)); }, timeout);
    };
    socket.on('error', error => finish(new Error(`Query socket failed: ${error.message}`)));
    socket.on('message', (data, remote) => {
      if (remote.port !== port) return;
      if (data.length === 9 && data.subarray(0, 4).equals(HEADER) && data[4] === 0x41) return send(Buffer.concat([REQUEST, data.subarray(5, 9)]));
      try { const info = parseInfo(data); if (info) finish(null, { ...info, host, port, latencyMs: Date.now() - started }); }
      catch (error) { finish(error); }
    });
    socket.bind(0, () => send(REQUEST));
  });
}
