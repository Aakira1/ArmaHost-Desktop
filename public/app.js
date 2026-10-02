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
const inputKeys = ['gameExe', 'serverExe', 'serverName', 'password', 'adminPassword', 'mission', 'difficulty', 'vpnIp', 'rconPassword', 'publicIp', 'remoteHost', 'remotePassword', 'joinMethod', 'audience'];
const flagKeys = ['lan', 'battleye', 'persistent', 'autoInit', 'autoRestart', 'liveMap', 'fastJoin', 'hugePages', 'upnp', 'starlink', 'starlinkVpn', 'rconEnabled'];
const settingIds = new Set([...inputKeys, ...flagKeys, 'adminSteamIds', 'port', 'maxPlayers', 'verifySignatures', 'modRoots', 'rconPort', 'remotePort', 'liveMapInterval']);
const escapeText = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fileName = value => value.replaceAll('\\', '/').split('/').filter(Boolean).pop() || value;
const modKey = value => value.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '');
function notify(message, error = false) {
  $('toast').title = 'Click to dismiss';
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
  if (name === 'logs') { renderLogs(); unseenProblems = 0; updateNavBadges(); }
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
  value.adminSteamIds = $('adminSteamIds').value.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean);
  return value;
}
function populate(settings, revision) {
  for (const key of inputKeys) $(key).value = settings[key];
  for (const key of flagKeys) $(key).checked = settings[key];
  for (const key of ['port', 'maxPlayers', 'verifySignatures', 'rconPort', 'remotePort', 'liveMapInterval']) $(key).value = settings[key];
  $('modRoots').value = settings.modRoots.join('\n');
  $('adminSteamIds').value = settings.adminSteamIds.join(', ');
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
  $('detail-network').textContent = a.starlink ? a.starlinkVpn ? 'Friends elsewhere · Starlink VPN' : 'Friends elsewhere · Starlink' : AUDIENCE_LABEL[a.audience || (a.lan ? 'home' : 'self')];
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
  $('join-pending').hidden = !st.pendingJoin;
  if (st.pendingJoin) $('join-pending-text').textContent = `The game will launch automatically once the server is online (waiting ${duration(Math.floor((Date.now() - st.pendingJoin.since) / 1000))}).`;
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
let unseenProblems = 0;
function updateNavBadges() {
  $('nav-log-badge').hidden = !unseenProblems; $('nav-log-badge').textContent = unseenProblems > 99 ? '99+' : String(unseenProblems);
  $('nav-log-badge').title = `${unseenProblems} new problem line(s) since you last opened Logs`;
}
// Persistent status in the top bar so server state is visible from every page.
function renderTopStatus(next) {
  const st = next.status, ready = st.pid && st.ready;
  const label = st.busy ? st.busy.toUpperCase() : ready ? (st.ready.stage === 'mission' ? 'READY' : 'ONLINE') : st.state.toUpperCase();
  $('top-server-text').textContent = `${next.demo ? 'DEMO · ' : ''}SERVER ${label}${st.pid ? ` · ${duration(st.uptimeSeconds)}` : ''}`;
  $('top-server').dataset.state = ready ? 'ready' : st.busy ? 'busy' : st.state;
  $('nav-server-dot').dataset.state = $('top-server').dataset.state;
  $('top-action').textContent = st.pid ? 'Stop server' : 'Start server';
  $('top-action').disabled = Boolean(st.busy) || busy || st.state === 'stopping';
  $('nav-map-badge').hidden = next.mapStatus !== 'live';
}
function updateControls() {
  const running = state?.status.state === 'running'; const transitioning = busy || Boolean(state?.status.busy) || shuttingDown;
  $('start-server').disabled = !state || Boolean(state.status.pid) || transitioning || state.status.state === 'stopping';
  for (const id of ['join-game', 'restart-server', 'stop-server', 'query-server']) $(id).disabled = !running || transitioning;
  if (state?.status.pendingJoin) $('join-game').disabled = true;
  $('join-remote').disabled = !state || transitioning;
  if (state?.live) renderLive(state.live);
}
function applyState(next, hydrate = false) {
  if (state && next.revision < state.revision) return; // A slow poll must not undo a newer save.
  const previousPid = state ? state.status.pid || null : undefined;
  state = next;
  if (hydrate || (!dirty && editRevision !== next.revision)) { populate(next.settings, next.revision); setDirty(false); }
  const s = next.status.active || next.settings;
  $('hero-name').textContent = s.serverName;
  $('hero-mission').textContent = s.mission || 'No mission set (optional): the admin picks one in game with #login, then #missions.';
  $('hero-mission').classList.toggle('warning-text', !s.mission);
  $('hero-address').textContent = next.network?.address || (next.network?.missing === 'publicIp' ? 'Public IP not set' : `127.0.0.1:${s.port}`);
  $('hosting-cta').hidden = next.demo || next.network?.scope !== 'local';
  $('hero-network').textContent = s.starlink ? s.starlinkVpn ? 'Friends elsewhere · Starlink VPN' : 'Friends elsewhere · Starlink' : AUDIENCE_LABEL[s.audience || (s.lan ? 'home' : 'self')];
  const pidChanged = previousPid !== (next.status.pid || null);
  if (pidChanged || hydrate) queueMicrotask(() => { void refreshInvite(); });
  $('server-status').textContent = (next.demo ? 'DEMO · ' : '') + next.status.state.toUpperCase();
  $('server-status').classList.toggle('running', next.status.state === 'running');
  for (const name of ['failed', 'starting', 'stopping']) $('server-status').classList.toggle(name, next.status.state === name);
  renderDetails(next); renderTopStatus(next);
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
  $('server-preview').textContent = value.server; $('client-preview').textContent = value.client; $('game-command').textContent = value.client; $('config-preview').textContent = value.config;
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
onButton('start-server', async () => {
  if (dirty) await save(true);
  const noMission = !state.demo && !state.settings.mission;
  applyState(await api('/api/server/start', {})); await refreshPreview(); notify(state.demo ? 'Demo process started. No Arma server is running.' : 'Dedicated server process started (the game was not launched). Check its logs before joining.');
  // A mission is optional: without one, the admin picks it in game.
  if (noMission) setTimeout(() => notify('Started without a mission, which is fine. To pick one in game: type #login, then #missions. Or use Missions › Co-op starter.'), 2500);
});
onButton('stop-server', async () => {
  if (!await confirmAction('Stop the server?', 'This terminates the managed server process and may lose unsaved mission progress. Save in the mission first. Your game is not closed.', 'Stop server')) return;
  applyState(await api('/api/server/stop', {})); notify('Managed server process stopped.');
});
onButton('restart-server', async () => {
  if (!await confirmAction('Restart the server?', 'This stops the owned process and starts a new one with your saved settings. Unsaved mission progress may be lost. Dashboard edits will be saved first.', 'Restart server')) return;
  if (dirty) await save(true); applyState(await api('/api/server/restart', {})); await refreshPreview(); notify('Server process restarted. Check the log before joining.');
});
onButton('join-game', async () => {
  if (dirty) await save(true);
  let whenReady = false;
  if (!state.demo && state.status.pid && !state.status.ready && $('joinMethod').value !== 'launcher') {
    // Launching while the server is still loading makes both load at once and the game sit at the logo.
    whenReady = await confirmAction('The server is still loading', 'Wait for the server to come online and launch the game automatically? This avoids the game and server loading at the same time. While waiting you can still press Launch now to start the game immediately.', 'Join when ready');
    if (!whenReady) return;
  }
  await launch(() => api('/api/game/join', { whenReady })); applyState(await api('/api/state'));
});
onButton('join-now', async () => { await api('/api/game/join/cancel', {}); await launch(() => api('/api/game/join', {})); applyState(await api('/api/state')); });
onButton('join-cancel', async () => { applyState(await api('/api/game/join/cancel', {})); notify('Automatic join cancelled.'); });
onButton('join-remote', async () => { if (dirty) await save(true); await launch(() => api('/api/game/join-remote', {})); });
for (const id of ['open-launcher', 'open-launcher-join']) onButton(id, async () => { if (dirty) await save(true); await launch(() => api('/api/game/launcher', {})); });
// Runs a game/launcher request. If Arma is already running, shows exactly which processes are open
// (the dedicated server and the game together are normal; two games are not) and offers to close
// the game-side ones, then repeats the request.
async function launch(request) {
  const result = await request();
  if (result.running?.length && (!result.launcher || result.alreadyOpen)) {
    if (result.alreadyOpen) await withCopiedAddress(result);
    if (await showRunning(result)) {
      const closed = await api('/api/game/close', { pids: result.running.filter(p => p.closable).map(p => p.pid) });
      if (closed.results.some(r => !r.ok)) { notify(closed.message, true); return; }
      const again = await request();
      if (again.running?.length && !again.launcher) { notify(again.message, true); return; }
      notify(`${closed.message} ${await withCopiedAddress(again)}`);
    }
    return;
  }
  notify(await withCopiedAddress(result));
}
function showRunning(result) {
  const dialog = $('running-dialog'); dialog.returnValue = '';
  $('running-title').textContent = result.alreadyOpen ? 'The Arma 3 Launcher is already open' : 'Arma 3 is already running';
  $('running-message').textContent = result.alreadyOpen
    ? 'Switch to it on the taskbar. If you can’t see it, close it here and a fresh one opens.'
    : result.launched === false
      ? 'A copy of the game that is stuck (for example at the Arma logo) stops a new one from loading. Close it here and ArmaHost starts Arma 3 again.'
      : 'A copy of the game that is stuck (for example at the Arma logo) stops a new one from loading. Close it here and the Arma 3 Launcher opens.';
  $('running-list').replaceChildren(...result.running.map(p => {
    const item = document.createElement('li'); item.className = p.closable ? '' : 'keep';
    const name = document.createElement('code'); name.textContent = `${p.name} · PID ${p.pid}`;
    const role = document.createElement('span'); role.className = 'role'; role.textContent = p.closable ? p.role : `${p.role} · not closed`;
    item.append(name, role); return item;
  }));
  const server = result.running.some(p => !p.closable);
  $('running-note').textContent = server ? 'Your dedicated server shows as a separate Arma 3 process in Task Manager. That is expected and it is not closed.' : '';
  $('running-close').textContent = result.alreadyOpen ? 'Close and reopen the launcher' : result.launched === false ? 'Close Arma 3 and launch again' : 'Close Arma 3 and open the launcher';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }); dialog.showModal(); });
}
$('running-cancel').addEventListener('click', () => $('running-dialog').close('no'));
$('running-close').addEventListener('click', () => $('running-dialog').close('yes'));
// Copies text. The desktop app denies the page clipboard permission, so it copies through the
// desktop bridge; a browser uses the Clipboard API, then the older copy command.
async function copyText(text) {
  if (window.armaDesktop?.copyText) { await window.armaDesktop.copyText(text); return; }
  try { await navigator.clipboard.writeText(text); return; } catch { /* Try the fallback below. */ }
  const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  const ok = document.execCommand('copy'); area.remove();
  if (!ok) throw new Error('Couldn’t copy. Select the text and press Ctrl+C.');
}
// Launcher joins: put host:port on the clipboard for the launcher's Direct Connect box.
async function withCopiedAddress(result) {
  if (!result.connect) return result.message;
  try { await copyText(`${result.connect.host}:${result.connect.port}`); return `${result.message} Address copied.`; } catch { return result.message; }
}
onButton('detect-steam-id', async () => {
  const result = await api('/api/steam/accounts', {});
  if (!result.accounts.length) { notify(result.note, true); return; }
  const account = result.accounts[0];
  const ids = new Set($('adminSteamIds').value.split(/[\s,;]+/).filter(Boolean)); ids.add(account.steamId);
  $('adminSteamIds').value = [...ids].join(', '); setDirty();
  notify(`Added ${account.name} (${account.steamId}) as an admin. Save to apply, then restart the server.`);
});
onButton('detect-public-ip', async () => {
  const result = await api('/api/network/public-ip', {});
  if (result.ok) { $('publicIp').value = result.ip; $('publicIp').dispatchEvent(new Event('input', { bubbles: true })); }
  notify(result.message, !result.ok);
});
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
  applyState(await api('/api/state'));  void refreshInvite();
});
onButton('copy-command', async () => { await copyText($('detail-command').textContent); notify('Server command copied (passwords redacted).'); });
$('error-diagnostics').addEventListener('click', () => $('diagnose-top').click());
onButton('copy-address', async () => { await copyText($('hero-address').textContent); notify('Local server address copied.'); });
onButton('check-live', async () => { const result = await api('/api/live/check', {}); state.live = result; renderLive(result); notify(result.status === 'connected' ? `Server responded: ${result.players.length} player(s) connected.` : result.status === 'demo' ? 'Demo check only: no real server connection.' : result.error || 'Server connection is unavailable.', result.status === 'disconnected'); });
onButton('send-live', async () => { const result = await api('/api/live/message', { message: $('live-message').value }); notify(result.message); });
onButton('generate-rcon-password', async () => { $('rconPassword').value = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join(''); setDirty(); notify('RCon password generated. Save and restart to apply it.'); });
onButton('quit', async () => {
  if (!await confirmAction('Quit ArmaHost?', 'The managed server will be terminated without an in-game save. Unsaved dashboard edits are discarded. A separately launched game is left running.', 'Quit & stop server')) return;
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
  if (!result.missions.length) container.innerHTML = `<div class="empty-state"><span>◇</span><h3>No installed missions found</h3><p>Use the Co-op starter above to create one in a click. ${escapeText(result.warnings.join(' ') || 'Add a mission to MPMissions, or enter a built-in template above.')}</p></div>`;
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
// Highlight lines that look like problems so they stand out in long logs.
function severity(message) {
  if (/\b(error|failed|failure|fatal|exception|cannot|could not|not found|crash(ed)?|refus(ed|ing)|denied)\b/i.test(message)) return 'error';
  if (/\b(warning|warn|missing|stale|timeout|timed out|unavailable|not confirmed)\b/i.test(message)) return 'warn';
  return '';
}
function logMarkup(entry) {
  return `<div class="log-line ${severity(entry.message)}"><span class="log-time">${escapeText(new Date(entry.time).toLocaleTimeString([], { hour12: false }))}</span><span class="log-source">${escapeText(entry.source.toUpperCase())}</span><span class="log-message">${escapeText(entry.message)}</span></div>`;
}
function renderLogs() {
  $('mini-log').innerHTML = logEntries.slice(-9).map(logMarkup).join('') || '<p class="muted">No session events yet.</p>';
  $('mini-log').scrollTop = $('mini-log').scrollHeight;
  if ($('log-pause').checked) return;
  const source = $('log-source').value; const filter = $('log-filter').value.toLowerCase();
  const problems = $('log-problems').checked;
  const visible = logEntries.filter(entry => (source === 'all' || entry.source === source) && entry.message.toLowerCase().includes(filter) && (!problems || severity(entry.message)));
  const container = $('full-log'); const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 55;
  container.innerHTML = visible.map(logMarkup).join('') || '<p class="muted">No matching log entries.</p>';
  $('log-count').textContent = `${visible.length} matching lines`;
  if (atBottom) container.scrollTop = container.scrollHeight;
}
for (const id of ['log-source', 'log-filter', 'log-pause', 'log-problems']) $(id).addEventListener('input', renderLogs);
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
    if (result.entries.length) {
      logEntries.push(...result.entries); logEntries = logEntries.slice(-1000); renderLogs();
      if ($('page-logs').hidden) { unseenProblems += result.entries.filter(e => severity(e.message) === 'error').length; updateNavBadges(); }
    }
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
const AUDIENCE_LABEL = { self: 'Just me · this PC only', home: 'Home network · LAN', internet: 'Friends elsewhere · internet' };
const AUDIENCE_SUMMARY = {
  self: 'The server only answers on 127.0.0.1. You can play on this PC; nobody else can connect. Choose another option to let friends join.',
  home: 'The server accepts connections from your network. Friends on your router or Wi-Fi join with this PC’s LAN address. Optionally set a join password, allow the server through Windows Firewall below, then restart the server.',
  internet: 'The server accepts connections from the internet. Optionally set a join password, detect your public IPv4, forward the UDP game ports on your router (or try UPnP), allow the server through Windows Firewall below, then restart the server.'
};
for (const card of document.querySelectorAll('[data-audience]')) card.addEventListener('click', () => {
  $('audience').value = card.dataset.audience; setDirty(); renderNetworkDraft();
  if (card.dataset.audience !== 'self' && !firewallChecked) void withBusy($('firewall-check'), checkFirewall);
});
function renderNetworkDraft() {
  if (!['self', 'home', 'internet'].includes($('audience').value)) $('audience').value = $('lan').checked ? ($('publicIp').value ? 'internet' : 'home') : 'self';
  if ($('starlink').checked) $('audience').value = 'internet';
  const audience = $('audience').value;
  for (const card of document.querySelectorAll('[data-audience]')) card.setAttribute('aria-checked', String(card.dataset.audience === audience));
  $('lan').checked = audience !== 'self';
  $('internet-options').hidden = audience !== 'internet';
  $('firewall-panel').hidden = audience === 'self';
  $('audience-summary').textContent = AUDIENCE_SUMMARY[audience];
  const starlink = $('starlink').checked;
  const vpn = starlink && $('starlinkVpn').checked;
  $('network-kind').textContent = { self: 'JUST ME', home: 'HOME NETWORK', internet: starlink ? 'INTERNET · STARLINK' : 'INTERNET' }[audience];
  $('network-description').textContent = starlink ? vpn ? 'Starlink hosting through an existing VPN.' : 'Direct Starlink hosting with public IPv4. No VPN software required.' : 'Normal internet connection (not Starlink): friends connect to your public IPv4.';
  $('direct-network').hidden = vpn;
  $('normal-network-steps').hidden = starlink;
  $('starlink-network-steps').hidden = !starlink;
  $('vpn-options').hidden = !starlink;
  $('vpn-fields').hidden = !vpn;
}
// Windows Firewall helper (Setup › Who will play?).
let firewallChecked = false;
function renderFirewall(result) {
  firewallChecked = true;
  const badge = $('firewall-badge');
  const label = !result.supported ? 'NOT AVAILABLE' : result.error ? 'UNKNOWN' : result.blocks?.length ? 'BLOCKED' : result.ok ? 'ALLOWED' : 'NOT ALLOWED';
  badge.textContent = label; badge.classList.toggle('ready', label === 'ALLOWED');
  $('firewall-status').textContent = result.error || result.message;
  const blocks = result.blocks || [];
  $('firewall-blocks').hidden = !blocks.length;
  $('firewall-blocks').replaceChildren(...blocks.map(b => { const li = document.createElement('li'); const c = document.createElement('code'); c.textContent = b.displayName; const r = document.createElement('span'); r.className = 'role'; r.textContent = `Block · ${b.profile}`; li.append(c, r); return li; }));
  $('firewall-remove-blocks').hidden = !blocks.length;
  for (const id of ['firewall-allow', 'firewall-remove']) $(id).disabled = !result.supported;
  $('firewall-allow').textContent = result.ok ? 'Allowed ✓ (update rule)' : 'Allow this Arma server through Windows Firewall';
}
// Checks the saved server program and port; it never saves the form.
async function checkFirewall() { renderFirewall(await api('/api/firewall/status', {})); }
onButton('firewall-check', checkFirewall);
onButton('firewall-allow', async () => {
  if (dirty) await save(true);
  notify('Windows will ask for administrator permission to add the rule…');
  try { renderFirewall(await api('/api/firewall/allow', {})); notify('Windows Firewall now allows this Arma server.'); }
  finally { try { renderFirewall(await api('/api/firewall/status', {})); } catch { /* Keep the last result. */ } }
});
onButton('firewall-remove', async () => {
  if (!await confirmAction('Remove ArmaHost’s firewall rule?', 'Friends may no longer be able to reach your server. Windows will ask for administrator permission.', 'Remove rule')) return;
  renderFirewall(await api('/api/firewall/remove', {})); notify('ArmaHost’s firewall rule was removed.');
});
onButton('firewall-remove-blocks', async () => {
  if (!await confirmAction('Remove the blocking rules?', 'These Windows Firewall rules block this Arma server program (Windows usually creates them when someone pressed Cancel on its first-run prompt). Only rules that block this exact program are removed. Windows will ask for administrator permission.', 'Remove blocking rules')) return;
  renderFirewall(await api('/api/firewall/remove-blocks', { confirm: true })); notify('Blocking rules removed.');
});
// Invite a friend (Overview): built from the running session, with an evidence-only checklist.
const CHECK_LABEL = { pass: 'DONE', fail: 'PROBLEM', todo: 'TO DO', untested: 'NOT TESTED' };
async function refreshInvite() {
  if (!state) return;
  const running = Boolean(state.status.pid);
  try {
    const check = await api('/api/connection/check', {});
    $('invite-audience').textContent = { self: 'JUST ME', home: 'HOME NETWORK', internet: 'FRIENDS ELSEWHERE' }[check.audience] || '';
    $('connection-list').replaceChildren(...check.items.map(item => {
      const li = document.createElement('li'); li.className = item.state;
      const tag = document.createElement('span'); tag.textContent = CHECK_LABEL[item.state];
      const body = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.label; const detail = document.createElement('small'); detail.textContent = item.detail;
      body.append(title, detail); li.append(tag, body); return li;
    }));
    if (check.audience === 'self') { $('invite-intro').textContent = 'Who will play? is “Just me”, so nobody else can join. Change it in Setup to invite friends.'; $('invite-text').textContent = '—'; $('invite-copy').disabled = true; return; }
    if (!running) { $('invite-intro').textContent = 'Start the server to get an invite for the running session.'; $('invite-text').textContent = '—'; $('invite-copy').disabled = true; return; }
    const invite = await api('/api/invite', { includePassword: $('invite-password').checked });
    $('invite-intro').textContent = `Friends join ${invite.address}. Send them this message.`;
    $('invite-text').textContent = invite.text; $('invite-copy').disabled = false;
    $('invite-password').disabled = !invite.hasPassword;
  } catch (error) { $('invite-intro').textContent = error.message; $('invite-text').textContent = '—'; $('invite-copy').disabled = true; }
}
$('invite-password').addEventListener('change', () => { void refreshInvite(); });
onButton('connection-refresh', refreshInvite);
onButton('invite-copy', async () => { await copyText($('invite-text').textContent); notify($('invite-password').checked ? 'Invite copied, including the join password.' : 'Invite copied. Send the join password separately.'); });
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
  await copyText(`Arma 3 session\nDirect Connect: ${result.address}\n${result.scope === 'vpn' ? 'Connect to the host through the same VPN first.' : result.scope === 'lan' ? 'LAN only: join from the same local network. For internet play, ask the host for its public IPv4.' : 'Internet: the host must forward its game ports through its router.'}\nUse matching mission mods. Ask the host for the join password separately.`);
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

$('toast').addEventListener('click', () => { $('toast').hidden = true; });
$('top-server').addEventListener('click', () => showPage('overview'));
$('top-action').addEventListener('click', () => { $(state?.status.pid ? 'stop-server' : 'start-server').click(); });
// Alt+1..7 switches pages.
const pageOrder = Object.keys(pages);
document.addEventListener('keydown', event => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  const page = pageOrder[Number(event.key) - 1];
  if (page) { event.preventDefault(); showPage(page); }
});
for (const [index, name] of pageOrder.entries()) document.querySelector(`[data-page="${name}"].nav`)?.setAttribute('title', `${pages[name][0]} (Alt+${index + 1})`);

// Co-op starter (Missions page): ArmaHost writes a ready co-op mission and selects it.
$('coop-world').addEventListener('change', () => { $('coop-name').textContent = `ArmaHost_Coop.${$('coop-world').value}`; });
onButton('coop-create', async () => {
  if (dirty) await save(true);
  const result = await api('/api/missions/create-coop', { world: $('coop-world').value, slots: Number($('coop-slots').value), zeus: $('coop-zeus').checked, arsenal: $('coop-arsenal').checked });
  applyState(result.state, true); notify(result.message);
});
