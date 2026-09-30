import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateSettings, serverArgs, clientArgs, renderConfig } from '../src/config.mjs';
import { vpnAddresses, hostingInfo } from '../src/network.mjs';
import { createApp } from '../src/http.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const settings = () => validateSettings({ ...defaults(), starlink: true, starlinkVpn: true, vpnIp: '100.101.2.3', password: 'friends-only' });
test('Starlink binds only the VPN address and permits remote game connections', () => {
  const s = settings();
  assert.ok(serverArgs(s, { configFile: 'a', profilesDir: 'b' }).includes('-ip=100.101.2.3'));
  assert.ok(clientArgs(s).includes('-connect=100.101.2.3'));
  assert.match(renderConfig(s), /loopback = 0;/);
});
test('Starlink requires a valid unicast IPv4 address and password', () => {
  for (const vpnIp of ['', 'example.com', '127.0.0.1', '0.0.0.0', '255.255.255.255', '224.1.2.3', '169.254.1.2', '100.1.2.3; calc']) assert.throws(() => validateSettings({ ...defaults(), starlink: true, starlinkVpn: true, vpnIp, password: 'ok' }));
  assert.throws(() => validateSettings({ ...defaults(), starlink: true, vpnIp: '100.101.2.3' }), /password/i);
  assert.throws(() => validateSettings({ ...defaults(), starlink: 'yes' }));
  assert.equal(validateSettings({ serverName: 'Old preset' }).starlink, false);
});
test('direct Starlink and normal network hosting use game network interfaces without a VPN', () => {
  for (const starlink of [false, true]) {
    const s = validateSettings({ ...defaults(), lan: true, starlink, password: 'friends', publicIp: '8.8.8.8', serverExe: 'C:\\Games\\arma3server_x64.exe' });
    assert.ok(serverArgs(s, { configFile: 'a', profilesDir: 'b' }).includes('-ip=0.0.0.0'));
    assert.ok(clientArgs(s).includes('-connect=127.0.0.1'));
    const info = hostingInfo(s, { Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }] });
    assert.equal(info.scope, 'internet'); assert.equal(info.address, '8.8.8.8:2302');
    assert.ok(info.firewall.includes('-Program'));
    assert.ok(!info.firewall.includes('-LocalAddress'));
  }
});
test('direct sharing rejects private and CGNAT IPs while preserving old VPN presets', () => {
  for (const publicIp of ['100.70.1.2', '192.168.1.1', '10.1.2.3', '172.16.1.1', '127.0.0.1']) assert.throws(() => validateSettings({ ...defaults(), publicIp }), /public|CGNAT/i);
  const legacy = validateSettings({ starlink: true, vpnIp: '100.101.2.3', password: 'friends' });
  assert.equal(legacy.starlinkVpn, true);
  const native = validateSettings({ ...defaults(), starlink: true, password: 'friends' });
  assert.equal(native.starlinkVpn, false);
});
test('VPN detection uses adapter identity rather than the shared CGNAT range', () => {
  const addresses = vpnAddresses({ Ethernet: [{ family: 'IPv4', address: '100.70.1.2', internal: false }], Tailscale: [{ family: 'IPv4', address: '100.101.2.3', internal: false }], ZeroTier: [{ family: 'IPv4', address: '10.8.0.2', internal: false }] });
  assert.equal(addresses.length, 2);
  assert.ok(!addresses.some(a => a.address === '100.70.1.2'));
});
test('hosting details keep passwords private and scope firewall to the VPN and server', () => {
  const s = { ...settings(), serverExe: "C:\\Games O'Brien\\arma3server_x64.exe" };
  const info = hostingInfo(s, { VPN: [{ family: 'IPv4', address: s.vpnIp, internal: false }] });
  assert.equal(info.address, '100.101.2.3:2302');
  assert.equal(info.assigned, true);
  assert.ok(!JSON.stringify(info).includes(s.password));
  assert.ok(info.firewall.includes("O''Brien"));
  assert.ok(info.firewall.includes('-LocalAddress 100.101.2.3'));
  assert.equal(hostingInfo(s, {}).assigned, false);
});
test('network API authenticates requests and uses the running server settings until restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-vpn-'));
  let app;
  try {
    app = await createApp({ root: fileURLToPath(new URL('..', import.meta.url)), dir, demo: true, port: 0 });
    assert.equal((await fetch(app.url + '/api/network')).status, 401);
    await app.store.saveSettings(settings(), 0);
    await app.manager.start(settings());
    await app.store.saveSettings({ ...settings(), vpnIp: '100.101.2.4' }, 1);
    const response = await fetch(app.url + '/api/network', { headers: { 'X-Arma-Token': app.token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).address, '100.101.2.3:2302');
    await app.manager.stop();
    const next = await fetch(app.url + '/api/network', { headers: { 'X-Arma-Token': app.token } });
    assert.equal((await next.json()).address, '100.101.2.4:2302');
  } finally { await app?.close(); await rm(dir, { recursive: true, force: true }); }
});
