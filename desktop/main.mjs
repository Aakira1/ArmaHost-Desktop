import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createApp } from '../src/http.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const smoke = process.argv.includes('--smoke-test');
let window, backend, boundsFile, smokeOriginal;
let quitting = false, closePrompt = false, dirty = false;
app.setName('ArmaHost Desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => { if (backend && !quitting) { event.preventDefault(); void requestClose(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(boot).catch(async error => {
    if (smoke) { console.error(error.message); if (smokeOriginal && backend) await backend.store.saveSettings(smokeOriginal, backend.store.snapshot().revision); await backend?.close(); app.exit(1); return; }
    dialog.showErrorBox('ArmaHost could not start', error.message); quitting = true; app.quit();
  });
}
async function finishQuit() {
  if (quitting) return;
  quitting = true;
  try { await backend?.close(); app.quit(); }
  catch (error) { quitting = false; dialog.showErrorBox('Could not stop server', error.message); }
}
async function requestClose() {
  if (closePrompt || quitting) return;
  closePrompt = true;
  try {
    if (backend?.manager.child || dirty) {
      const result = await dialog.showMessageBox(window, {
        type: 'warning', title: 'Close ArmaHost?', buttons: ['Keep open', 'Close ArmaHost'], defaultId: 0, cancelId: 0,
        message: backend?.manager.child ? 'Closing will stop your managed server.' : 'You have unsaved changes.',
        detail: 'Unsaved edits and mission progress may be lost. Save your mission before closing. Your separately launched game stays open.'
      });
      if (result.response !== 1) return;
    }
    await finishQuit();
  } finally { closePrompt = false; }
}
async function boot() {
  const dir = path.join(app.getPath('userData'), demo ? 'demo-data' : 'data');
  await mkdir(dir, { recursive: true });
  boundsFile = path.join(app.getPath('userData'), 'window.json');
  let bounds = {};
  try { bounds = JSON.parse(await readFile(boundsFile, 'utf8')); } catch {}
  backend = await createApp({ root, dir, demo, port: 0, onQuit: finishQuit });
  window = new BrowserWindow({
    width: Math.max(1000, Math.min(Number(bounds.width) || 1320, 2400)), height: Math.max(700, Math.min(Number(bounds.height) || 880, 1600)),
    minWidth: 900, minHeight: 640, show: false, backgroundColor: '#111711', title: 'ArmaHost Desktop',
    webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  const trusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== backend.url) throw new Error('Untrusted desktop request.');
  };
  ipcMain.handle('desktop:pick', async (event, kind) => {
    trusted(event);
    if (!['game', 'server', 'mod', 'root'].includes(kind)) throw new Error('Unknown picker.');
    const directory = kind === 'mod' || kind === 'root';
    const result = await dialog.showOpenDialog(window, { title: directory ? 'Choose an installed mod folder' : 'Choose Arma 3 executable', properties: [directory ? 'openDirectory' : 'openFile'], ...(directory ? {} : { filters: [{ name: 'Windows executable', extensions: ['exe'] }] }) });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('desktop:data', async event => { trusted(event); const error = await shell.openPath(dir); if (error) throw new Error(error); });
  ipcMain.handle('desktop:vpn-guide', async event => { trusted(event); await shell.openExternal('https://tailscale.com/docs/use-cases/personal-or-at-home-use/share-private-game-server'); });
  ipcMain.on('desktop:dirty', (event, value) => { trusted(event); dirty = value === true; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Native close confirmation already covers unsaved edits. Let an approved quit
  // proceed past the browser's beforeunload handler.
  window.webContents.on('will-prevent-unload', event => { if (quitting) event.preventDefault(); });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== backend.url) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.on('close', event => { if (!quitting) { event.preventDefault(); void requestClose(); } });
  window.on('resize', () => { if (!window.isMaximized() && !window.isMinimized()) { const { width, height } = window.getBounds(); void writeFile(boundsFile, JSON.stringify({ width, height })).catch(() => {}); } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ label: 'Open data folder', click: () => { void shell.openPath(dir); } }, { type: 'separator' }, { label: 'Quit', accelerator: 'Alt+F4', click: () => { void requestClose(); } }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'About ArmaHost', click: () => { void dialog.showMessageBox(window, { title: 'ArmaHost Desktop', message: 'ArmaHost Desktop 1.3.0', detail: 'An unofficial local Arma 3 server manager. Built on Arma 3 Local Host.' }); } }] }
  ]));
  window.once('ready-to-show', () => window.show());
  await window.loadURL(backend.url + '/#token=' + backend.token);
  if (smoke) {
    const original = backend.store.snapshot();
    smokeOriginal = original.settings;
    const smokeSettings = { ...original.settings, rconEnabled: true, rconPassword: 'smoke-rcon-test-password', remoteHost: '8.8.8.8', starlink: false, starlinkVpn: false, lan: false, publicIp: '' };
    await backend.store.saveSettings(smokeSettings, original.revision);
    await window.loadURL(backend.url + '/#token=' + backend.token);
    await new Promise(resolve => setTimeout(resolve, 1800));
    const result = await window.webContents.executeJavaScript("({ bridge: !!window.armaDesktop, connected: document.getElementById('connection').textContent, pickers: document.querySelectorAll('.native-browse').length })");
    if (!result.bridge || !result.connected.includes('connected') || result.pickers !== 4) throw new Error('Desktop smoke check failed: ' + JSON.stringify(result));
    await backend.manager.start(backend.store.snapshot().settings);
    await new Promise(resolve => setTimeout(resolve, 600));
    if (!backend.manager.child) throw new Error('Demo server exited unexpectedly.');
    result.demoStarted = backend.manager.status().state;
    await window.webContents.executeJavaScript("document.getElementById('check-live').disabled=false; document.getElementById('check-live').click();");
    await new Promise(resolve => setTimeout(resolve, 350));
    result.liveCheck = await window.webContents.executeJavaScript("document.getElementById('live-status').textContent");
    if (!result.liveCheck.includes('SIMULATED')) throw new Error('Live check UI did not report demo mode: ' + result.liveCheck + '. Monitor: ' + JSON.stringify(backend.monitor.snapshot()));
    await window.webContents.executeJavaScript("document.getElementById('send-live').click();");
    await new Promise(resolve => setTimeout(resolve, 350));
    result.testMessage = await window.webContents.executeJavaScript("document.getElementById('toast').textContent.includes('no in-game message')");
    if (!result.testMessage) throw new Error('Test message UI did not respond.');
    await backend.manager.stop();
    result.demoStopped = !backend.manager.child;
    await window.webContents.executeJavaScript("document.getElementById('role-join').click(); document.getElementById('join-remote').click();");
    await new Promise(resolve => setTimeout(resolve, 350));
    result.joinWithoutServer = await window.webContents.executeJavaScript("!document.getElementById('join-panel').hidden && document.getElementById('toast').textContent.includes('no game was launched')");
    if (!result.joinWithoutServer) throw new Error('Join without server did not respond.');
    result.starlinkControls = await window.webContents.executeJavaScript("!!document.getElementById('starlink') && !!document.getElementById('vpnIp') && !!document.getElementById('detect-vpn')");
    if (!result.starlinkControls) throw new Error('Starlink controls missing.');
    await window.webContents.executeJavaScript("document.querySelector('[data-page=setup]').click(); document.getElementById('network-details').click(); document.getElementById('starlink').click();");
    await new Promise(resolve => setTimeout(resolve, 400));
    result.networkPanel = await window.webContents.executeJavaScript("document.getElementById('vpn-note').textContent.includes('local only')");
    if (!result.networkPanel) throw new Error('Network panel API did not respond.');
    result.directStarlink = await window.webContents.executeJavaScript("!document.getElementById('starlink-network-steps').hidden && !document.getElementById('direct-network').hidden && document.getElementById('network-kind').textContent === 'STARLINK'");
    if (!result.directStarlink) throw new Error('Direct Starlink switch did not update.');
    await mkdir(path.join(root, 'docs', 'screenshots'), { recursive: true });
    await writeFile(path.join(root, 'desktop-smoke.json'), JSON.stringify(result, null, 2));
    await writeFile(path.join(root, 'docs', 'screenshots', 'desktop.png'), (await window.webContents.capturePage()).toPNG());
    await backend.store.saveSettings(original.settings, backend.store.snapshot().revision);
    await finishQuit();
  }
}
