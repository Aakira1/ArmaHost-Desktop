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
  const audience = s.audience || (!enabled ? 'self' : s.publicIp ? 'internet' : 'home');
  const scope = vpn ? 'vpn' : !enabled ? 'local' : audience === 'internet' ? 'internet' : 'lan';
  // Friends elsewhere need the public address; without it there is nothing correct to show yet.
  const ip = vpn ? s.vpnIp : !enabled ? '127.0.0.1' : scope === 'internet' ? s.publicIp : lanAddresses[0]?.address || '';
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  return {
    addresses: vpnAddresses(interfaces), lanAddresses, assigned, enabled, scope, audience,
    missing: scope === 'internet' && !s.publicIp ? 'publicIp' : scope === 'lan' && !ip ? 'lanAddress' : null,
    mode: vpn ? 'starlink-vpn' : s.starlink ? 'starlink-direct' : s.lan ? 'normal' : 'local',
    address: ip ? `${ip}:${s.port}` : '',
    firewall: enabled && assigned && s.serverExe
      ? `New-NetFirewallRule -DisplayName 'ArmaHost ${vpn ? 'VPN' : 'Game'}' -Direction Inbound -Action Allow -Protocol UDP -LocalPort ${s.port}-${s.port + 4}${vpn ? ` -LocalAddress ${s.vpnIp}` : ''} -Program ${quote(s.serverExe)} -Profile Any` : '',
    forwardPorts: `${s.port}-${s.port + 4}`, targetAddresses: lanAddresses.map(e => e.address),
    note: 'Detection is local only. It does not verify router forwarding, peer access, firewall rules or game readiness.'
  };
}

// Asks one public "what is my IP" service, only when the user presses Detect. Never automatic.
export const PUBLIC_IP_SERVICE = 'https://api.ipify.org?format=json';
export async function detectPublicIp(fetcher = fetch) {
  let ip;
  try {
    const response = await fetcher(PUBLIC_IP_SERVICE, { signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ip = String((await response.json()).ip || '');
  } catch (error) { return { ok: false, message: `Couldn't detect your public IP (${error.message}). Check your internet connection, or look it up on your router and enter it manually.` }; }
  if (!publicAddress(ip)) return { ok: false, message: `The detection service returned ${ip.slice(0, 40) || 'nothing'}, which isn't a public IPv4 address. Enter it manually from your router.` };
  return { ok: true, ip, message: `Detected public IPv4 ${ip}. If your router's own WAN address is in 100.64-100.127.x.x (CGNAT, common on Starlink and some mobile providers), port forwarding can't work; use the VPN option instead.` };
}

// The text a host sends to a friend. Built from the running session's settings; it never contains
// the admin or RCon password, the dashboard link or local folder paths. The join password is only
// included when the host chooses to.
export function inviteText(s, hosting, { includePassword = false, mods = [] } = {}) {
  if (!hosting.address) throw new Error(hosting.missing === 'publicIp' ? 'Enter or detect your public IPv4 in Setup first, then restart the server.' : 'No address to share yet. Choose who will play in Setup and restart the server.');
  const [host, port] = [hosting.address.slice(0, hosting.address.lastIndexOf(':')), hosting.address.slice(hosting.address.lastIndexOf(':') + 1)];
  const lines = [`Join my Arma 3 server: ${s.serverName}`, '', `Address: ${host}`, `Port: ${port}`,
    `Password: ${!s.password ? 'none' : includePassword ? s.password : 'I will send it separately'}`, ''];
  if (hosting.scope === 'vpn') lines.push('Connect to my VPN network first (the same one I use), then:');
  if (hosting.scope === 'lan') lines.push('You need to be on the same home network as me. Then:');
  lines.push('1. Open the Arma 3 Launcher (Steam > Arma 3 > Play).');
  if (mods.length) {
    lines.push('2. Enable these mods in the launcher (subscribe on the Steam Workshop first if you don’t have them):');
    for (const m of mods) lines.push(`   - ${m.name}${m.workshopId ? ` https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}` : ''}`);
    lines.push('3. Press Play. In Arma 3: Multiplayer > Server Browser > Direct Connect.');
  } else lines.push('2. Press Play (no mods needed). In Arma 3: Multiplayer > Server Browser > Direct Connect.');
  lines.push(`${mods.length ? 4 : 3}. Enter ${host} and port ${port}, then join.`);
  return lines.join('\n');
}
