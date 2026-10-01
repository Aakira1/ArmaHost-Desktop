import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { defaults, validateSettings, serverArgs, renderConfig } from '../src/config.mjs';
import { hostingInfo, inviteText } from '../src/network.mjs';
import { modInfo } from '../src/discovery.mjs';
import { Firewall, allowScript, removeBlocksScript, ruleName, firewallProfiles } from '../src/firewall.mjs';
import { createApp } from '../src/http.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const LAN = { Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }] };
const serverExe = 'C:\\Games\\Arma 3 Server\\arma3server_x64.exe';

test('Who will play? decides the bind address; old settings are migrated from the LAN toggle', () => {
  const v = extra => validateSettings({ ...defaults(), password: 'friends', serverExe, ...extra });
  assert.equal(validateSettings(defaults()).audience, 'self');
  assert.equal(v({ lan: true }).audience, 'home');
  assert.equal(v({ lan: true, publicIp: '8.8.8.8' }).audience, 'internet');
  assert.equal(v({ starlink: true }).audience, 'internet');
  // Saved settings from before 1.7.0 have no audience key at all.
  const legacy = { ...defaults(), lan: true, password: 'friends' }; delete legacy.audience;
  assert.equal(validateSettings(legacy).audience, 'home');
  // An explicit choice wins over a stale toggle, in both directions.
  assert.equal(v({ audience: 'self', lan: true }).lan, false);
  assert.equal(v({ audience: 'internet', lan: false }).lan, true);
  assert.ok(serverArgs(v({ audience: 'self' }), { configFile: 'a', profilesDir: 'b' }).includes('-ip=127.0.0.1'));
  assert.ok(serverArgs(v({ audience: 'home' }), { configFile: 'a', profilesDir: 'b' }).includes('-ip=0.0.0.0'));
  assert.match(renderConfig(v({ audience: 'self' })), /loopback = 1;/);
  assert.match(renderConfig(v({ audience: 'home' })), /loopback = 0;/);
  assert.throws(() => v({ audience: 'everyone' }), /who will play/i);
  assert.throws(() => validateSettings({ ...defaults(), audience: 'home' }), /join password/i);
});

test('the address friends get depends on who will play', () => {
  const info = extra => hostingInfo(validateSettings({ ...defaults(), password: 'friends', serverExe, ...extra }), LAN);
  assert.equal(info({ audience: 'self' }).address, '127.0.0.1:2302');
  assert.equal(info({ audience: 'home', publicIp: '8.8.8.8' }).address, '192.168.1.10:2302', 'home uses the LAN address even when a public IP is saved');
  assert.equal(info({ audience: 'internet', publicIp: '8.8.8.8' }).address, '8.8.8.8:2302');
  const missing = info({ audience: 'internet' });
  assert.equal(missing.address, ''); assert.equal(missing.missing, 'publicIp');
});

test('invite text has the address, mods and Workshop links, and never the admin or RCon password', () => {
  const s = validateSettings({ ...defaults(), audience: 'internet', publicIp: '8.8.8.8', password: 'joinpw', adminPassword: 'ADMINSECRET', rconEnabled: true, rconPassword: 'RCONSECRET123', serverExe, serverName: 'Ops Night' });
  const hosting = hostingInfo(s, LAN);
  const mods = [{ name: 'CBA_A3', workshopId: '450814997' }, { name: 'Local thing', workshopId: '' }];
  const hidden = inviteText(s, hosting, { mods });
  assert.match(hidden, /Ops Night/); assert.match(hidden, /Address: 8\.8\.8\.8/); assert.match(hidden, /Port: 2302/);
  assert.match(hidden, /Password: I will send it separately/);
  assert.match(hidden, /CBA_A3 https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=450814997/);
  assert.match(hidden, /Direct Connect/);
  for (const text of [hidden, inviteText(s, hosting, { mods, includePassword: true })]) {
    assert.ok(!/ADMINSECRET|RCONSECRET123|arma3server|C:\\/.test(text), 'no admin/RCon secrets or local paths');
  }
  assert.match(inviteText(s, hosting, { includePassword: true }), /Password: joinpw/);
  assert.throws(() => inviteText(s, { ...hosting, address: '', missing: 'publicIp' }), /public IPv4/);
  const home = validateSettings({ ...defaults(), audience: 'home', password: 'x', serverExe });
  assert.match(inviteText(home, hostingInfo(home, LAN)), /same home network/);
});

test('mod Workshop ids come from meta.cpp or the Workshop folder name', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-mods-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cba = path.join(dir, '@CBA'); await mkdir(cba);
  await writeFile(path.join(cba, 'meta.cpp'), 'protocol = 1;\npublishedid = 450814997;\nname = "CBA_A3";\n');
  assert.deepEqual(await modInfo(cba), { name: 'CBA_A3', workshopId: '450814997' });
  const workshop = path.join(dir, 'workshop', 'content', '107410', '843425103'); await mkdir(workshop, { recursive: true });
  assert.deepEqual(await modInfo(workshop), { name: '843425103', workshopId: '843425103' });
  const local = path.join(dir, '@Local'); await mkdir(local);
  await writeFile(path.join(local, 'meta.cpp'), 'publishedid = 0;\n');
  assert.equal((await modInfo(local)).workshopId, '');
});

test('firewall scripts are scoped to ArmaHost\'s own rule and quote values safely', () => {
  const s = { serverExe: "C:\\Games\\Bob's Arma\\arma3server_x64.exe", port: 2402 };
  const script = allowScript(s, ['Private']);
  assert.match(script, /-DisplayName 'ArmaHost Arma 3 server \(UDP 2402-2406\)' -Group 'ArmaHost'/);
  assert.match(script, /-Program 'C:\\Games\\Bob''s Arma\\arma3server_x64\.exe'/, 'single quotes doubled');
  assert.match(script, /-Protocol UDP -LocalPort '2402-2406'/); assert.match(script, /-Profile 'Private'/);
  assert.match(script, /Get-NetFirewallRule -Group 'ArmaHost'.*Remove-NetFirewallRule/, 'replaces only its own group');
  assert.ok(!/Set-NetFirewallProfile|-Enabled False/i.test(script), 'never disables the firewall');
  for (const bad of ['C:\\a\\"x.exe', 'C:\\a\\$(calc).exe', 'relative\\arma3server.exe', '']) assert.throws(() => allowScript({ serverExe: bad, port: 2302 }, ['Private']));
  assert.match(removeBlocksScript(["TCP Query User{x}'c:\\a.exe"]), /-Name 'TCP Query User\{x\}''c:\\a\.exe'/);
  assert.throws(() => removeBlocksScript([]));
  assert.deepEqual(firewallProfiles(['Public', 'DomainAuthenticated', 'Public']), ['Public', 'Domain']);
  assert.deepEqual(firewallProfiles([]), ['Private']);
  assert.equal(ruleName(2302), 'ArmaHost Arma 3 server (UDP 2302-2306)');
});

test('firewall helper: status parsing, admin prompt, declined prompt', async () => {
  const s = { serverExe, port: 2302 };
  assert.equal((await new Firewall({ platform: 'linux' }).status(s)).supported, false);
  assert.equal((await new Firewall({ platform: 'win32', demo: true }).status(s)).supported, false);
  const calls = []; let elevated = false; let ruleOk = false; let decline = false; let elevatedFails = false; let silentElevated = false;
  const run = async (file, args, options) => {
    calls.push({ file, args, env: options.env });
    const command = args.join(' ');
    if (command.includes('IsInRole')) return { stdout: elevated ? 'True\r\n' : 'False\r\n' };
    if (command.includes('Start-Process')) {
      if (decline) throw Object.assign(new Error('failed'), { stderr: 'The operation was canceled by the user.' });
      // Play the elevated copy: it reports through the result file named in its script.
      const script = Buffer.from(command.match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('utf16le');
      const resultFile = script.match(/^\$ResultFile = '(.*)'$/m)[1].replaceAll("''", "'");
      if (elevatedFails) { await writeFile(resultFile, 'FAIL The parameter is incorrect.'); return { stdout: '' }; }
      if (!silentElevated) { ruleOk = true; await writeFile(resultFile, '\uFEFFOK\r\n'); }
      return { stdout: '' };
    }
    if (args.includes('-EncodedCommand')) { ruleOk = true; return { stdout: '' }; }
    return { stdout: JSON.stringify(ruleOk
      ? { exists: true, enabled: true, profile: 'Private', ports: '2302-2306', program: serverExe, others: [], networks: 'Private', blocks: [] }
      : { exists: false, enabled: false, profile: '', ports: '', program: '', others: [], networks: ['Public'], blocks: { name: 'UDP Query User{1}', displayName: 'arma3server_x64.exe', profile: 'Public' } }) };
  };
  const fw = new Firewall({ platform: 'win32', run });
  const before = await fw.status(s);
  assert.equal(before.ok, false); assert.equal(before.blocks.length, 1); assert.match(before.message, /blocking/);
  assert.deepEqual(before.profiles, ['Public']);
  const statusCall = calls.find(c => c.env?.AH_PROGRAM);
  assert.equal(statusCall.env.AH_PROGRAM, serverExe, 'values reach PowerShell as environment variables, not script text');
  const after = await fw.allow(s);
  assert.equal(after.ok, true);
  const prompt = calls.find(c => c.args.join(' ').includes('Start-Process'));
  assert.ok(prompt.args.join(' ').includes('-Verb RunAs'), 'not elevated: goes through the Windows admin prompt');
  const encoded = prompt.args.join(' ').match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1];
  assert.match(Buffer.from(encoded, 'base64').toString('utf16le'), /-Profile 'Public'/, 'rule targets the current network category');
  ruleOk = false; decline = true;
  await assert.rejects(fw.allow(s), /declined.*nothing was changed/);
  decline = false; ruleOk = false; elevatedFails = true;
  await assert.rejects(fw.allow(s), /Windows refused the rule: The parameter is incorrect/, 'the elevated copy\'s error is shown');
  elevatedFails = false; silentElevated = true;
  await assert.rejects(fw.allow(s), /did not report a result/, 'an elevated copy that never ran is not reported as success');
  silentElevated = false;
  decline = false; elevated = true; calls.length = 0;
  await fw.allow(s);
  assert.ok(!calls.some(c => c.args.join(' ').includes('Start-Process')), 'already elevated: no prompt');
});

test('API: invite uses the running session, hides the password unless asked; connection check reports untested items', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-invite-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await createApp({ root, dir, demo: true, port: 0 });
  try {
    const headers = { 'X-Arma-Token': app.token, 'Content-Type': 'application/json' };
    const post = async (route, body = {}) => { const r = await fetch(app.url + route, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    assert.equal((await post('/api/invite')).status, 409, 'needs a running server');
    const state = await (await fetch(app.url + '/api/state', { headers })).json();
    const settings = { ...state.settings, audience: 'internet', publicIp: '8.8.8.8', password: 'joinpw', adminPassword: 'ADMINSECRET' };
    assert.equal((await post('/api/config', { settings, revision: state.revision })).status, 200);
    await post('/api/server/start');
    const invite = (await post('/api/invite')).body;
    assert.equal(invite.address, '8.8.8.8:2302'); assert.equal(invite.includesPassword, false);
    assert.ok(!invite.text.includes('joinpw') && !invite.text.includes('ADMINSECRET'));
    assert.match((await post('/api/invite', { includePassword: true })).body.text, /Password: joinpw/);
    const check = (await post('/api/connection/check')).body;
    assert.equal(check.items.find(i => i.id === 'process').state, 'pass');
    assert.equal(check.items.find(i => i.id === 'outside').state, 'untested');
    assert.ok(check.items.every(i => ['pass', 'fail', 'todo', 'untested'].includes(i.state)));
    assert.equal((await post('/api/firewall/status')).body.supported, false, 'demo never touches the firewall');
    assert.equal((await post('/api/firewall/remove-blocks', {})).status, 400, 'needs explicit confirmation');
  } finally { await app.close(); }
});

test('admin Steam IDs are validated and written to server.cfg; loginusers.vdf is parsed', async () => {
  const { parseLoginUsers } = await import('../src/discovery.mjs');
  const s = validateSettings({ ...defaults(), adminSteamIds: ['76561198000000001', '76561198000000001', '76561198000000002'] });
  assert.deepEqual(s.adminSteamIds, ['76561198000000001', '76561198000000002']);
  assert.match(renderConfig(s), /admins\[\] = \{"76561198000000001", "76561198000000002"\};/);
  assert.ok(!/admins\[\]/.test(renderConfig(validateSettings(defaults()))), 'no admins line when none are set');
  for (const bad of [['123'], ['76561198000000001"};'], [76561198000000001], 'x', Array(11).fill('76561198000000001')]) assert.throws(() => validateSettings({ ...defaults(), adminSteamIds: bad }), /Steam64/);
  const vdf = `"users"\n{\n\t"76561198000000005"\n\t{\n\t\t"AccountName"\t\t"old"\n\t\t"PersonaName"\t\t"Old Account"\n\t\t"MostRecent"\t\t"0"\n\t}\n\t"76561198000000009"\n\t{\n\t\t"AccountName"\t\t"gamer"\n\t\t"PersonaName"\t\t"Gamertroll101"\n\t\t"MostRecent"\t\t"1"\n\t}\n}\n`;
  assert.deepEqual(parseLoginUsers(vdf)[0], { steamId: '76561198000000009', name: 'Gamertroll101', mostRecent: true });
  assert.equal(parseLoginUsers(vdf).length, 2); assert.deepEqual(parseLoginUsers('garbage'), []);
});

test('a missing mission is flagged in diagnostics and the invite', async t => {
  const { diagnostics } = await import('../src/discovery.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-mission-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const s = validateSettings({ ...defaults(), port: 24900 + (process.pid % 50) * 10 });
  const row = (await diagnostics(s, dir, false)).checks.find(c => c.name === 'Mission');
  assert.equal(row.ok, false); assert.match(row.detail, /empty Role Assignment.*#login.*#missions/);
  const home = validateSettings({ ...defaults(), audience: 'home', password: 'x', serverExe });
  assert.match(inviteText(home, hostingInfo(home, LAN)), /still needs to pick a mission/);
  assert.ok(!inviteText({ ...home, mission: 'Coop.Altis' }, hostingInfo(home, LAN)).includes('pick a mission'));
});
