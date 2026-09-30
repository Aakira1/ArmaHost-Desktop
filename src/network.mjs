import os from 'node:os';
import { isIPv4 } from 'node:net';

export function usableAddress(value) {
  if (!isIPv4(value)) return false;
  const [a, b] = value.split('.').map(Number);
  return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254);
}
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
  const assigned = localAddresses(interfaces).some(e => e.address === s.vpnIp);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  return {
    addresses: vpnAddresses(interfaces), assigned, enabled: s.starlink,
    address: s.starlink && usableAddress(s.vpnIp) ? `${s.vpnIp}:${s.port}` : '',
    firewall: s.starlink && usableAddress(s.vpnIp) && s.serverExe
      ? `New-NetFirewallRule -DisplayName 'ArmaHost VPN' -Direction Inbound -Action Allow -Protocol UDP -LocalPort ${s.port}-${s.port + 4} -LocalAddress ${s.vpnIp} -Program ${quote(s.serverExe)} -Profile Any` : '',
    note: 'VPN detection is local only. It does not verify peer access, firewall rules or game readiness.'
  };
}
