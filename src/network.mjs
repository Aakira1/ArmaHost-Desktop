import dgram from 'node:dgram';
import os from 'node:os';
import { isIPv4 } from 'node:net';

export function usableAddress(value) {
  if (!isIPv4(value)) return false;
  const [a, b] = value.split('.').map(Number);
  return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254);
}
export function publicAddress(value) {
  if (!usableAddress(value)) return false;
  const [a, b] = value.split('.').map(Number);
  return a !== 10 && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
}
export function udpPortFree(port, address) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', () => { try { socket.close(); } catch {} resolve(false); });
    socket.bind(port, address, () => socket.close(() => resolve(true)));
  });
}
export function bindAddress(s) { return s.starlink && s.starlinkVpn ? s.vpnIp : s.lan || s.starlink ? '0.0.0.0' : '127.0.0.1'; }
export function gameAddress(s) { return s.starlink && s.starlinkVpn ? s.vpnIp : '127.0.0.1'; }
export function localAddresses(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
    .filter(e => (e.family === 'IPv4' || e.family === 4) && !e.internal && usableAddress(e.address))
    .map(e => ({ name, address: e.address })));
}
export function vpnAddresses(interfaces = os.networkInterfaces()) {
  // Starlink and Tailscale share CGNAT space. The IP range alone does not identify a VPN.
  return localAddresses(interfaces).filter(e => /tailscale|zerotier|wireguard|hamachi|vpn/i.test(e.name));
}
export function hostingInfo(s, interfaces = os.networkInterfaces()) {
  const vpn = s.starlink && s.starlinkVpn;
  const enabled = s.starlink || s.lan;
  const addresses = localAddresses(interfaces);
  const assigned = !vpn || addresses.some(e => e.address === s.vpnIp);
  const lanAddresses = addresses.filter(e => !/tailscale|zerotier|wireguard|hamachi|vpn/i.test(e.name));
  const scope = vpn ? 'vpn' : !enabled ? 'local' : s.publicIp ? 'internet' : 'lan';
  const ip = vpn ? s.vpnIp : !enabled ? '127.0.0.1' : s.publicIp || lanAddresses[0]?.address || '';
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  return {
    addresses: vpnAddresses(interfaces), lanAddresses, assigned, enabled, scope,
    mode: vpn ? 'starlink-vpn' : s.starlink ? 'starlink-direct' : s.lan ? 'normal' : 'local',
    address: ip ? `${ip}:${s.port}` : '',
    firewall: enabled && assigned && s.serverExe
      ? `New-NetFirewallRule -DisplayName 'ArmaHost ${vpn ? 'VPN' : 'Game'}' -Direction Inbound -Action Allow -Protocol UDP -LocalPort ${s.port}-${s.port + 4}${vpn ? ` -LocalAddress ${s.vpnIp}` : ''} -Program ${quote(s.serverExe)} -Profile Any` : '',
    forwardPorts: `${s.port}-${s.port + 4}`, targetAddresses: lanAddresses.map(e => e.address),
    note: 'Detection is local only. It does not verify router forwarding, peer access, firewall rules or game readiness.'
  };
}
