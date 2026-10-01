import { initMap } from './map.js';
const $ = id => document.getElementById(id);
const pages = {
  overview: ['Operations overview', 'Your dedicated server, managed from your own machine.'],
  setup: ['Configure your session', 'Choose your installations and set the rules for your server.'],
  missions: ['Mission selection', 'Load a scenario from your installed server content.'],
  mods: ['Build your loadout', 'Choose installed mods for the game, the server, or both.'],
  presets: ['Saved sessions', 'Keep your favourite configurations ready for the next operation.'],
  logs: ['Session logs', 'Follow process events and inspect startup errors in one place.'],
  map: ['Live map', 'Players, AI, vehicles and markers from the running server.']
};
let token = new URLSearchParams(location.hash.slice(1)).get('token');
try { if (token) sessionStorage.setItem('arma-local-token', token); else token = sessionStorage.getItem('arma-local-token'); } catch { /* A fragment token also works with storage blocked. */ }
if (location.hash.includes('token=')) history.replaceState(null, '', location.pathname);
let state = null;
let editRevision = null;
let draftMods = [];
let dirty = false;
let busy = false;
let polling = false;
let shuttingDown = false;
let logCursor = 0;
let logEntries = [];
let toastTimer;
let presetSignature = '';
const inputKeys = ['gameExe', 'serverExe', 'serverName', 'password', 'adminPassword', 'mission', 'difficulty', 'vpnIp', 'rconPassword', 'publicIp', 'remoteHost', 'remotePassword'];
const flagKeys = ['lan', 'battleye', 'persistent', 'autoInit', 'autoRestart', 'liveMap', 'starlink', 'starlinkVpn', 'rconEnabled'];
const settingIds = new Set([...inputKeys, ...flagKeys, 'port', 'maxPlayers', 'verifySignatures', 'modRoots', 'rconPort', 'remotePort', 'liveMapInterval']);
const escapeText = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fileName = value => value.replaceAll('\\', '/').split('/').filter(Boolean).pop() || value;
const modKey = value => value.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '');
function notify(message, error = false) {
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9500 : 5500);
}
function setDirty(value = true) { dirty = value; $('save-bar').hidden = !value; }
function showPage(name) {
  if (!pages[name]) return;
  for (const [page] of Object.entries(pages)) $(`page-${page}`).hidden = page !== name;
  document.querySelectorAll('[data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page === name); button.setAttribute('aria-current', button.dataset.page === name ? 'page' : 'false'); });
  $('page-title').textContent = pages[name][0]; $('page-description').textContent = pages[name][1];
  $('breadcrumb').textContent = name === 'map' ? 'Live map' : name[0].toUpperCase() + name.slice(1);
  if (name === 'logs') renderLogs();
  if (name === 'map') liveMap.start(); else liveMap.stop();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function authNeeded() { if (!$('auth-dialog').open) $('auth-dialog').showModal(); }
$('auth-dialog').addEventListener('cancel', event => event.preventDefault());
async function apiBlob(route) {
  const response = await fetch(route, { headers: { 'X-Arma-Token': token }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.blob();
}
async function api(route, body = undefined) {
  if (!token) { authNeeded(); throw new Error('Open the private dashboard link printed in the launcher console.'); }
  const headers = { 'X-Arma-Token': token };
  const options = { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) };
  if (body !== undefined) { options.method = 'POST'; headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  let response;
  try { response = await fetch(route, options); }
  catch { throw new Error('Cannot reach the local manager. Keep its console open and check the private dashboard link.'); }
  const value = await response.json();
  if (response.status === 401) authNeeded();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
  return value;
}
function collectSettings() {
  const value = {};
  for (const key of inputKeys) value[key] = $(key).value;
  for (const key of flagKeys) value[key] = $(key).checked;
  for (const key of ['port', 'maxPlayers', 'verifySignatures', 'rconPort', 'remotePort', 'liveMapInterval']) value[key] = Number($(key).value);
  value.mods = structuredClone(draftMods);
  value.modRoots = $('modRoots').value.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
  return value;
}
function populate(settings, revision) {
  for (const key of inputKeys) $(key).value = settings[key];
  for (const key of flagKeys) $(key).checked = settings[key];
  for (const key of ['port', 'maxPlayers', 'verifySignatures', 'rconPort', 'remotePort', 'liveMapInterval']) $(key).value = settings[key];
  $('modRoots').value = settings.modRoots.join('\n');
  draftMods = structuredClone(settings.mods); editRevision = revision; renderMods(); validatePaths();
  renderNetworkDraft();
}
function duration(seconds) { return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':'); }
function renderDetails(next) {
  const st = next.status; const live = Boolean(st.pid && st.active); const a = st.active || next.settings;
  $('config-scope').textContent = live ? 'ACTIVE SERVER CONFIG' : 'NEXT SERVER START';
  $('detail-exe').textContent = next.demo ? 'Demo worker (no Arma process)' : st.serverExe || next.settings.serverExe || 'Not configured';
  $('detail-state').textContent = `${st.pid || '—'} · ${st.state.toUpperCase()}${live ? ` · up ${duration(st.uptimeSeconds)}` : ''}`;
  $('detail-port').textContent = `UDP ${a.port}–${a.port + 4}${next.settings.rconEnabled ? ` · RCon ${next.settings.rconPort}` : ''}`;
  $('detail-mission').textContent = a.mission || 'Chosen in game';
  const mods = live ? st.active.modList : next.settings.mods.filter(m => m.enabled);
  $('detail-mods').textContent = mods.length ? `${mods.length}: ${mods.map(m => `${m.path.split(/[\\/]/).pop()} (${m.scope})`).join(', ')}` : 'None (vanilla)';
  $('detail-network').textContent = a.starlink ? a.starlinkVpn ? 'Starlink · VPN hosting' : 'Starlink · direct hosting' : a.lan ? 'Normal network · LAN / internet' : 'Normal network · this PC only';
  $('detail-command-title').textContent = live ? 'ACTIVE SERVER CONFIG — command' : 'NEXT SERVER START — command';
  $('detail-command').textContent = (live ? st.command : $('server-preview').textContent) || '—';
  $('detail-error').hidden = !st.lastError; $('detail-error-text').textContent = st.lastError || '';
  const key = p => p.replaceAll('\\', '/').toLowerCase();
  const stale = live ? st.active.modList.filter(m => !next.settings.mods.some(x => x.enabled && key(x.path) === key(m.path))) : [];
  $('detail-diff').hidden = !next.pendingRestart;
  $('detail-diff').textContent = stale.length
    ? `The running server was started with ${stale.length} mod(s) no longer in your Mods list: ${stale.map(m => m.path.split(/[\\/]/).pop()).join(', ')}. Restart Server to apply your current Mods list.`
    : 'ACTIVE SERVER CONFIG above is what is running now. Saved settings differ and apply at NEXT SERVER START (use Restart Server).';
  if (queriedPid && queriedPid !== st.pid) queriedPid = null;
  const ready = st.pid ? st.ready : null;
  $('ready-badge').textContent = next.demo ? 'DEMO' : ready ? (ready.stage === 'mission' ? 'READY · MISSION STARTED' : 'ONLINE') : st.pid ? 'LOADING…' : 'NOT RUNNING';
  $('ready-badge').classList.toggle('ready', Boolean(ready));
  if (!st.pid) $('query-result').textContent = st.autoRestartPending ? 'Server crashed; auto-restart is pending.' : 'After starting, use Test server is up to confirm the server answers.';
  else if (ready && !queriedPid) $('query-result').textContent = ready.label + '.';
}
let queriedPid = null;
const SERVER_NAMES = ['arma3server_x64.exe', 'arma3server.exe'], GAME_NAMES = ['arma3_x64.exe', 'arma3.exe'];
function exeName(value) { return value.trim().split(/[\\/]/).pop().toLowerCase(); }
function validatePaths() {
  const server = $('serverExe').value.trim(), game = $('gameExe').value.trim();
  const errors = {
    serverExe: server && !SERVER_NAMES.includes(exeName(server)) ? `"${exeName(server)}" is not a dedicated server. Use arma3server_x64.exe${GAME_NAMES.includes(exeName(server)) ? ' — this is the game; put it in Arma 3 Game Installation below' : ''}.` : '',
    gameExe: game && !GAME_NAMES.includes(exeName(game)) ? `"${exeName(game)}" is not the game executable. Use arma3_x64.exe${SERVER_NAMES.includes(exeName(game)) ? ' — this is the server; put it in Dedicated Server Installation above' : ''}.` : ''
  };
  if (server && game && server.toLowerCase().replaceAll('/', '\\') === game.toLowerCase().replaceAll('/', '\\')) errors.gameExe = 'Game and server must be different files.';
  for (const [id, message] of Object.entries(errors)) { $(`${id}-error`).hidden = !message; $(`${id}-error`).textContent = message; $(id).classList.toggle('invalid', Boolean(message)); }
}
for (const id of ['serverExe', 'gameExe']) $(id).addEventListener('input', validatePaths);
function updateControls() {
  const running = state?.status.state === 'running'; const transitioning = busy || Boolean(state?.status.busy) || shuttingDown;
  $('start-server').disabled = !state || Boolean(state.status.pid) || transitioning || state.status.state === 'stopping';
  for (const id of ['join-game', 'restart-server', 'stop-server', 'query-server']) $(id).disabled = !running || transitioning;
  $('join-remote').disabled = !state || transitioning;
  if (state?.live) renderLive(state.live);
}
function applyState(next, hydrate = false) {
  if (state && next.revision < state.revision) return; // A slow poll must not undo a newer save.
  state = next;
  if (hydrate || (!dirty && editRevision !== next.revision)) { populate(next.settings, next.revision); setDirty(false); }
  const s = next.status.active || next.settings;
  $('hero-name').textContent = s.serverName;
  $('hero-mission').textContent = s.mission || 'Mission selection opens in game.';
  $('hero-address').textContent = next.network?.address || `127.0.0.1:${s.port}`;
  $('hero-network').textContent = s.starlink ? s.starlinkVpn ? 'Starlink · VPN hosting' : 'Starlink · direct hosting' : s.lan ? 'Normal network · LAN / internet' : 'Normal network · this PC only';
  $('server-status').textContent = (next.demo ? 'DEMO · ' : '') + next.status.state.toUpperCase();
  $('server-status').classList.toggle('running', next.status.state === 'running');
  for (const name of ['failed', 'starting', 'stopping']) $('server-status').classList.toggle(name, next.status.state === name);
  renderDetails(next);
  $('metric-pid').textContent = next.status.pid || '—';
  $('metric-uptime').textContent = duration(next.status.uptimeSeconds);
  $('metric-mods').textContent = String(next.status.active?.mods ?? next.settings.mods.filter(m => m.enabled).length).padStart(2, '0');
  $('metric-players').textContent = s.maxPlayers;
  $('process-note').textContent = next.status.lastError || (next.status.pid ? next.status.readiness : 'The manager controls only the server it starts. Your game is separate.');
  $('demo-banner').hidden = !next.demo; $('mode-badge').textContent = next.demo ? 'DEMO MODE' : 'LOCAL';
  $('restart-notice').hidden = !next.pendingRestart;
  $('footer-port').textContent = `${location.hostname} · TCP ${location.port}`;
  for (const [type, key] of [['game', 'gameExe'], ['server', 'serverExe']]) {
    $(`${type}-check`).classList.toggle('checked', Boolean(next.settings[key]));
    $(`${type}-check`).textContent = next.settings[key] ? '✓' : type === 'game' ? '01' : '02';
    $(`${type}-check-note`).textContent = next.settings[key] ? 'Path saved · run diagnostics to verify.' : type === 'game' ? 'Optional · only for Launch Game & Join.' : 'Select the dedicated server.';
  }
  const signature = JSON.stringify(next.presets);
  if (signature !== presetSignature) { presetSignature = signature; renderPresets(); }
  updateControls();
  renderLive(next.live);
}
function renderLive(live) {
  if (!live) return;
  const labels = { stopped: 'SERVER STOPPED', disabled: 'NOT CONFIGURED', connecting: 'WAITING FOR RCON', connected: 'RCON CONNECTED', disconnected: 'RCON DISCONNECTED', demo: 'DEMO · SIMULATED' };
  $('live-status').textContent = labels[live.status] || 'NOT CHECKED';
  $('live-status').classList.toggle('running', live.status === 'connected');
  const checked = live.checkedAt ? new Date(live.checkedAt).toLocaleTimeString() : 'not checked yet';
  $('live-note').textContent = live.error || (live.status === 'disabled' ? 'Enable monitoring in Setup, save and restart the server.' : live.demo ? 'Demo only: no real RCon connection or players. Controls simulate a test message.' : `Last successful player check: ${checked}. Player lists refresh every 5 seconds. Connection events are observed while this app is running.`);
  const allowed = !['stopped', 'disabled'].includes(live.status) && !busy;
  $('check-live').disabled = !allowed;
  $('send-live').disabled = !allowed;
  $('live-players').innerHTML = live.players.length ? `<table class="players-table"><thead><tr><th>Player</th><th>Slot ID</th><th>Ping</th></tr></thead><tbody>${live.players.map(p => `<tr><td>${escapeText(p.name)}</td><td>${p.id}</td><td>${p.ping} ms</td></tr>`).join('')}</tbody></table>${live.status === 'disconnected' ? '<p class="help-text">Last known players — current connection unavailable.</p>' : ''}` : `<p class="help-text">${live.status === 'connected' ? 'Server responded. No players are currently connected.' : live.demo ? 'Demo mode does not invent player connections.' : 'No confirmed player list yet.'}</p>`;
  $('live-events').innerHTML = live.events.length ? live.events.slice(-30).reverse().map(e => `<p>${escapeText(new Date(e.time).toLocaleTimeString())} · ${escapeText(e.message)}</p>`).join('') : '<p class="muted">No connection activity recorded yet.</p>';
}
async function refreshPreview() {
  const value = await api('/api/preview');
  $('server-preview').textContent = value.server; $('client-preview').textContent = value.client; $('config-preview').textContent = value.config;
  if (state) renderDetails(state);
}
async function save(quiet = false) {
  const value = await api('/api/config', { settings: collectSettings(), revision: editRevision });
  applyState(value, true); await refreshPreview();
  if (!quiet) notify(value.pendingRestart ? 'Saved. Restart the server to apply the changes.' : 'Configuration saved.');
}
async function withBusy(button, action) {
  if (busy) { notify('Another action is still finishing.'); return; }
  busy = true; button?.classList.add('is-loading'); if (button) button.disabled = true; updateControls();
  try { await action(); }
  catch (error) { notify(error.message, true); }
  finally { busy = false; button?.classList.remove('is-loading'); if (button) button.disabled = false; updateControls(); }
}
function onButton(id, action) { $(id).addEventListener('click', () => { void withBusy($(id), action); }); }
function confirmAction(title, message, label = 'Confirm') {
  const dialog = $('confirm-dialog'); dialog.returnValue = '';
  $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-ok').textContent = label;
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }); dialog.showModal(); });
}
$('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close('no'));
$('confirm-ok').addEventListener('click', () => $('confirm-dialog').close('yes'));
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => $(button.dataset.closeDialog).close());
for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => showPage(button.dataset.page));
for (const button of document.querySelectorAll('[data-goto]')) button.addEventListener('click', () => showPage(button.dataset.goto));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); showPage('overview'); });
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
document.addEventListener('input', event => { if (settingIds.has(event.target.id)) setDirty(); });
document.addEventListener('change', event => { if (settingIds.has(event.target.id)) setDirty(); });
window.addEventListener('beforeunload', event => { if (dirty && !shuttingDown) { event.preventDefault(); event.returnValue = ''; } });
$('settings-form').addEventListener('submit', event => { event.preventDefault(); void withBusy(event.submitter, () => save()); });
for (const id of ['save-all', 'save-mission', 'save-mods']) onButton(id, () => save());
onButton('discard', async () => { if (await confirmAction('Discard unsaved edits?', 'This reloads the last saved configuration. The running server is not changed.', 'Discard edits')) { applyState(await api('/api/state'), true); } });
onButton('start-server', async () => { if (dirty) await save(true); applyState(await api('/api/server/start', {})); await refreshPreview(); notify(state.demo ? 'Demo process started. No Arma server is running.' : 'Dedicated server process started (the game was not launched). Check its logs before joining.'); });
onButton('stop-server', async () => {
  if (!await confirmAction('Stop the server?', 'This terminates the managed server process and may lose unsaved mission progress. Save in the mission first. Your game is not closed.', 'Stop server')) return;
  applyState(await api('/api/server/stop', {})); notify('Managed server process stopped.');
});
onButton('restart-server', async () => {
  if (!await confirmAction('Restart the server?', 'This stops the owned process and starts a new one with your saved settings. Unsaved mission progress may be lost. Dashboard edits will be saved first.', 'Restart server')) return;
  if (dirty) await save(true); applyState(await api('/api/server/restart', {})); await refreshPreview(); notify('Server process restarted. Check the log before joining.');
});
onButton('join-game', async () => { if (dirty) await save(true); const result = await api('/api/game/join', {}); notify(result.message); });
onButton('join-remote', async () => { if (dirty) await save(true); const result = await api('/api/game/join-remote', {}); notify(result.message); });
function sessionRole(join) {
  $('join-panel').hidden = !join; $('host-panel').hidden = join;
  for (const [id, active] of [['role-host', !join], ['role-join', join]]) {
    $(id).classList.toggle('primary', active); $(id).classList.toggle('subtle', !active); $(id).setAttribute('aria-pressed', String(active));
  }
  if (join && state?.status.pid) notify('Your own server is still running. Switching to Join does not stop it.');
}
$('role-host').addEventListener('click', () => sessionRole(false));
$('role-join').addEventListener('click', () => sessionRole(true));
onButton('query-server', async () => {
  $('query-result').textContent = 'Querying the server…';
  const result = await api('/api/server/query', {});
  queriedPid = result.ok ? state?.status.pid : null;
  $('query-result').textContent = result.message; notify(result.message, !result.ok);
  applyState(await api('/api/state'));
});
onButton('copy-command', async () => { await navigator.clipboard.writeText($('detail-command').textContent); notify('Server command copied (passwords redacted).'); });
$('error-diagnostics').addEventListener('click', () => $('diagnose-top').click());
onButton('copy-address', async () => { await navigator.clipboard.writeText($('hero-address').textContent); notify('Local server address copied.'); });
onButton('check-live', async () => { const result = await api('/api/live/check', {}); state.live = result; renderLive(result); notify(result.status === 'connected' ? `Server responded: ${result.players.length} player(s) connected.` : result.status === 'demo' ? 'Demo check only: no real server connection.' : result.error || 'Server connection is unavailable.', result.status === 'disconnected'); });
onButton('send-live', async () => { const result = await api('/api/live/message', { message: $('live-message').value }); notify(result.message); });
onButton('generate-rcon-password', async () => { $('rconPassword').value = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join(''); setDirty(); notify('RCon password generated. Save and restart to apply it.'); });
onButton('quit', async () => {
  if (!await confirmAction('Quit Local Host?', 'The managed server will be terminated without an in-game save. Unsaved dashboard edits are discarded. A separately launched game is left running.', 'Quit & stop server')) return;
  await api('/api/quit', {}); shuttingDown = true; setDirty(false); $('offline-banner').hidden = false; $('connection').textContent = 'Stopped'; notify('Local Host is closing. This tab can be closed.');
});
onButton('diagnose-top', async () => {
  if (dirty) await save(true); const result = await api('/api/diagnostics', {});
  $('diagnostics-content').innerHTML = result.checks.map(check => `<div class="diagnostic-row"><span class="diagnostic-mark ${check.ok ? '' : check.warning ? 'warn' : 'fail'}">${check.ok ? 'PASS' : check.warning ? 'NOTE' : 'CHECK'}</span><div><h3>${escapeText(check.name)}</h3><p>${escapeText(check.detail)}</p></div></div>`).join('');
  $('diagnostics-dialog').showModal();
});
onButton('auto-detect', async () => {
  const result = await api('/api/discover', {});
  for (const [key, id] of [['games', 'game-paths'], ['servers', 'server-paths']]) $(id).innerHTML = result[key].map(value => `<option value="${escapeText(value)}"></option>`).join('');
  let changed = false;
  if (!$('gameExe').value && result.games[0]) { $('gameExe').value = result.games[0]; changed = true; }
  if (!$('serverExe').value && result.servers[0]) { $('serverExe').value = result.servers[0]; changed = true; }
  if (result.modRoots.length) {
    const existing = $('modRoots').value.split(/\r?\n/).filter(Boolean); $('modRoots').value = [...new Set([...existing, ...result.modRoots])].join('\n'); changed = true;
  }
  if (changed) setDirty();
  $('discovery-note').textContent = `${result.games.length} game executable(s), ${result.servers.length} server executable(s), ${result.modRoots.length} mod root(s). ${result.notes.join(' ')} ${changed ? 'Review and save the detected paths.' : 'You can paste custom installation paths manually.'}`;
  notify(changed ? 'Detected paths filled in. Review them and save.' : 'No new paths were filled. Enter your installation paths manually.');
});
onButton('scan-missions', async () => {
  if (dirty) await save(true); const result = await api('/api/missions/scan', {});
  $('mission-folder').textContent = result.folder || 'No server path configured.';
  const container = $('mission-results'); container.replaceChildren();
  if (!result.missions.length) container.innerHTML = `<div class="empty-state"><span>◇</span><h3>No installed missions found</h3><p>${escapeText(result.warnings.join(' ') || 'Add a mission to MPMissions, or enter a built-in template above.')}</p></div>`;
  for (const mission of result.missions) {
    const card = document.createElement('div'); card.className = 'item-card';
    card.innerHTML = `<div class="item-info"><h3>${escapeText(mission.template)}</h3><p>${escapeText(mission.file)}</p></div><button class="button subtle">Select mission</button>`;
    card.querySelector('button').addEventListener('click', () => { $('mission').value = mission.template; setDirty(); notify('Mission selected. Save to apply on the next server start.'); }); container.append(card);
  }
  if (result.warnings.length && result.missions.length) notify(result.warnings.join(' '));
});
function renderMods() {
  const container = $('mod-list'); container.replaceChildren();
  if (!draftMods.length) container.innerHTML = '<p class="help-text">Vanilla loadout. Add a mod folder below, or discover installed mods.</p>';
  draftMods.forEach((mod, index) => {
    const row = document.createElement('div'); row.className = 'mod-row';
    row.innerHTML = `<input type="checkbox" aria-label="Enable ${escapeText(fileName(mod.path))}" ${mod.enabled ? 'checked' : ''}><span class="mod-path">${escapeText(mod.path)}</span><select aria-label="Mod scope"><option value="shared">Game + server</option><option value="server">Server only</option><option value="client">Game only</option></select><button class="icon-button move-mod" title="Move up" aria-label="Move mod up">↑</button><button class="icon-button move-mod" title="Move down" aria-label="Move mod down">↓</button><button class="icon-button remove-mod" title="Remove" aria-label="Remove mod">×</button>`;
    row.querySelector('select').value = mod.scope;
    row.querySelector('input').addEventListener('change', event => { draftMods[index].enabled = event.target.checked; setDirty(); });
    row.querySelector('select').addEventListener('change', event => { draftMods[index].scope = event.target.value; setDirty(); });
    const moves = row.querySelectorAll('.move-mod'); moves[0].disabled = index === 0; moves[1].disabled = index === draftMods.length - 1;
    moves[0].addEventListener('click', () => { [draftMods[index - 1], draftMods[index]] = [draftMods[index], draftMods[index - 1]]; setDirty(); renderMods(); });
    moves[1].addEventListener('click', () => { [draftMods[index + 1], draftMods[index]] = [draftMods[index], draftMods[index + 1]]; setDirty(); renderMods(); });
    row.querySelector('.remove-mod').addEventListener('click', () => { draftMods.splice(index, 1); setDirty(); renderMods(); });
    container.append(row);
  });
}
function addMod(modPath, scope = 'shared') {
  const value = modPath.trim(); if (!value) throw new Error('Enter an installed mod folder path.');
  if (draftMods.some(m => modKey(m.path) === modKey(value))) throw new Error('That mod folder is already in the loadout.');
  draftMods.push({ path: value, enabled: true, scope }); setDirty(); renderMods();
}
onButton('add-mod', async () => { addMod($('new-mod-path').value, $('new-mod-scope').value); $('new-mod-path').value = ''; });
onButton('scan-mods', async () => {
  await save(true); if (!state.settings.modRoots.length) throw new Error('Enter at least one mod scan root first.');
  const result = await api('/api/mods/scan', {}); const container = $('mod-results'); container.replaceChildren();
  const note = document.createElement('p'); note.className = 'help-text'; note.textContent = `${result.mods.length} installed mod folder(s) found. ${result.warnings.join(' ')}`; container.append(note);
  for (const mod of result.mods) {
    const card = document.createElement('div'); card.className = 'item-card';
    card.innerHTML = `<div class="item-info"><h3>${escapeText(mod.name)}</h3><p>${escapeText(mod.path)}</p></div><button class="button subtle">Add to loadout</button>`;
    const button = card.querySelector('button');
    button.disabled = draftMods.some(m => modKey(m.path) === modKey(mod.path));
    button.addEventListener('click', () => { try { addMod(mod.path); button.disabled = true; } catch (error) { notify(error.message, true); } }); container.append(card);
  }
});
function renderPresets() {
  const container = $('preset-list'); container.replaceChildren();
  if (!state.presets.length) container.innerHTML = '<div class="empty-state"><span>▱</span><h3>Your presets will appear here</h3><p>Give your current configuration a name and save it above.</p></div>';
  for (const preset of state.presets) {
    const card = document.createElement('div'); card.className = 'item-card';
    card.innerHTML = `<div class="item-info"><h3>${escapeText(preset.name)}</h3><p>Saved ${escapeText(new Date(preset.createdAt).toLocaleString())}</p></div><div class="item-actions"><button class="button subtle load-preset">Load preset</button><button class="button danger-outline delete-preset">Delete</button></div>`;
    const load = card.querySelector('.load-preset');
    load.addEventListener('click', () => void withBusy(load, async () => {
      if (!await confirmAction('Load this preset?', `Replace the dashboard configuration with “${preset.name}”? Unsaved edits will be discarded. A running server is not changed.`, 'Load preset')) return;
      const current = await api('/api/state');
      applyState(await api('/api/presets/load', { id: preset.id, revision: current.revision }), true); await refreshPreview(); notify('Preset loaded. It applies on the next server start.');
    }));
    const del = card.querySelector('.delete-preset');
    del.addEventListener('click', () => void withBusy(del, async () => {
      if (!await confirmAction('Delete this preset?', `Delete “${preset.name}”? Your current configuration will remain unchanged.`, 'Delete preset')) return;
      const current = await api('/api/state');
      const result = await api('/api/presets/delete', { id: preset.id, revision: current.revision });
      // Preset deletion does not alter settings; safe to advance this editor's revision only if settings did not change elsewhere.
      if (JSON.stringify(current.settings) === JSON.stringify(state.settings) && editRevision === state.revision) editRevision = result.revision;
      applyState(result); notify('Preset deleted.');
    })); container.append(card);
  }
}
onButton('save-preset', async () => {
  const name = $('preset-name').value.trim(); if (!name) throw new Error('Enter a preset name first.');
  if (dirty) await save(true);
  applyState(await api('/api/presets/create', { name, revision: editRevision }), true);
  $('preset-name').value = ''; notify('Preset saved.');
});
function logMarkup(entry) {
  return `<div class="log-line"><span class="log-time">${escapeText(new Date(entry.time).toLocaleTimeString([], { hour12: false }))}</span><span class="log-source">${escapeText(entry.source.toUpperCase())}</span><span class="log-message">${escapeText(entry.message)}</span></div>`;
}
function renderLogs() {
  $('mini-log').innerHTML = logEntries.slice(-9).map(logMarkup).join('') || '<p class="muted">No session events yet.</p>';
  $('mini-log').scrollTop = $('mini-log').scrollHeight;
  if ($('log-pause').checked) return;
  const source = $('log-source').value; const filter = $('log-filter').value.toLowerCase();
  const visible = logEntries.filter(entry => (source === 'all' || entry.source === source) && entry.message.toLowerCase().includes(filter));
  const container = $('full-log'); const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 55;
  container.innerHTML = visible.map(logMarkup).join('') || '<p class="muted">No matching log entries.</p>';
  $('log-count').textContent = `${visible.length} matching lines`;
  if (atBottom) container.scrollTop = container.scrollHeight;
}
for (const id of ['log-source', 'log-filter', 'log-pause']) $(id).addEventListener('input', renderLogs);
onButton('export-logs', async () => {
  const value = await api('/api/logs/export');
  const blob = new Blob([value.text], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'arma3-local-host-session.log'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function poll() {
  if (polling || shuttingDown || !token) return; polling = true;
  try {
    const next = await api('/api/state'); applyState(next);
    const result = await api(`/api/logs?after=${logCursor}`);
    if (result.cursor < logCursor) logEntries = [];
    logCursor = result.cursor;
    if (result.entries.length) { logEntries.push(...result.entries); logEntries = logEntries.slice(-1000); renderLogs(); }
    $('connection').innerHTML = '<i class="dot"></i> Local manager connected'; $('offline-banner').hidden = true;
  } catch { $('connection').textContent = 'Disconnected'; $('offline-banner').hidden = false; }
  finally { polling = false; }
}
async function refreshHostingDetails() {
  const result = await api('/api/network');
  $('vpn-firewall').textContent = result.firewall || 'Save a server executable and enable network hosting to generate the firewall command.';
  $('router-target').textContent = `Game ports: UDP ${result.forwardPorts}. Router forwarding target (this PC): ${result.lanAddresses.map(e => `${e.name}: ${e.address}`).join(' · ') || 'No LAN address detected'}.`;
  const description = result.scope === 'vpn' ? (result.assigned ? `VPN address ${result.address} is assigned. ` : 'Saved VPN address is not present. Connect the VPN and detect again. ') : result.scope === 'internet' ? `Share address: ${result.address}. Public address is supplied by you; external reachability is unverified. ` : result.scope === 'lan' ? `LAN address: ${result.address || 'not found'}. Enter your public IPv4 to share with internet friends. ` : 'This PC only. Enable incoming game connections for friends. ';
  $('vpn-note').textContent = description + (state?.status.pid ? 'Details reflect the running server. ' : '') + result.note;
  return result;
}
function renderNetworkDraft() {
  const starlink = $('starlink').checked;
  const vpn = starlink && $('starlinkVpn').checked;
  $('network-kind').textContent = starlink ? 'STARLINK' : 'NORMAL NETWORK';
  $('network-description').textContent = starlink ? vpn ? 'Starlink hosting through an existing VPN.' : 'Direct Starlink hosting with public IPv4. No VPN software required.' : 'Normal network: host on your LAN or directly over the internet.';
  $('direct-network').hidden = vpn;
  $('normal-network-steps').hidden = starlink;
  $('starlink-network-steps').hidden = !starlink;
  $('vpn-options').hidden = !starlink;
  $('vpn-fields').hidden = !vpn;
  $('lan').disabled = starlink;
  if (starlink) $('lan').checked = true;
}
for (const id of ['starlink', 'starlinkVpn']) $(id).addEventListener('change', renderNetworkDraft);
onButton('detect-vpn', async () => {
  const result = await refreshHostingDetails();
  const select = $('vpn-addresses'); select.replaceChildren(new Option('Choose a detected adapter', ''));
  for (const item of result.addresses) select.add(new Option(`${item.name} · ${item.address}`, item.address));
  if (result.addresses.length === 1) { select.value = result.addresses[0].address; $('vpnIp').value = select.value; setDirty(); }
  notify(result.addresses.length ? 'VPN addresses detected. Select one, enable Starlink hosting and save.' : 'No recognised VPN adapter found. Install and connect Tailscale, or enter your VPN address manually.');
});
$('vpn-addresses').addEventListener('change', () => { if ($('vpn-addresses').value) { $('vpnIp').value = $('vpn-addresses').value; setDirty(); } });
onButton('network-details', refreshHostingDetails);
onButton('copy-vpn', async () => {
  if (dirty) throw new Error('Save your changes first. Restart a running server to apply its new network settings.');
  const result = await refreshHostingDetails();
  if (!result.enabled || !result.assigned || !result.address) throw new Error('Enable network hosting and save its connection settings first.');
  await navigator.clipboard.writeText(`Arma 3 session\nDirect Connect: ${result.address}\n${result.scope === 'vpn' ? 'Connect to the host through the same VPN first.' : result.scope === 'lan' ? 'LAN only: join from the same local network. For internet play, ask the host for its public IPv4.' : 'Internet: the host must forward its game ports through its router.'}\nUse matching mission mods. Ask the host for the join password separately.`);
  notify('Friend connection details copied. Password is not included.');
});
onButton('vpn-guide', async () => {
  if (window.armaDesktop) await window.armaDesktop.openVpnGuide();
  else window.open('https://tailscale.com/docs/use-cases/personal-or-at-home-use/share-private-game-server', '_blank', 'noopener,noreferrer');
});
if (!token) authNeeded();
else {
  try { applyState(await api('/api/state'), true); await refreshPreview(); await poll(); }
  catch (error) { notify(error.message, true); $('offline-banner').hidden = false; }
  setInterval(() => { void poll(); }, 2000);
}

const liveMap = initMap({ api, apiBlob, notify, isVisible: () => !$('page-map').hidden });
