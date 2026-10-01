import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { AppError, validateSettings, renderConfig, serverArgs, clientArgs, displayCommand } from './config.mjs';
import { Store } from './store.mjs';
import { LogBook } from './logs.mjs';
import { ProcessManager } from './process-manager.mjs';
import { discoverInstallations, scanMissions, scanMods, diagnostics } from './discovery.mjs';
import { hostingInfo } from './network.mjs';
import { LiveMonitor } from './live-monitor.mjs';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/desktop.js', ['desktop.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
async function jsonBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new AppError('Content-Type must be application/json.', 415);
  if (Number(req.headers['content-length']) > 131072) throw new AppError('Request exceeds 128 KiB.', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 131072) throw new AppError('Request exceeds 128 KiB.', 413); chunks.push(chunk); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new AppError('Invalid JSON body.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Request body must be a JSON object.');
  return body;
}
export async function createApp({ root, dir, demo = false, port = 3000, onQuit = null }) {
  const store = await Store.open(dir);
  const logs = new LogBook(dir);
  const manager = new ProcessManager({ dir, logs, demo });
  await manager.restore();
  const monitor = new LiveMonitor(manager, logs);
  manager.gracefulStop = () => monitor.shutdown();
  const token = randomBytes(32).toString('hex');
  let closing = false; let actualPort; let closePromise;
  const refreshSecrets = () => {
    const state = store.snapshot();
    logs.setSecrets([state.settings.password, state.settings.adminPassword, state.settings.rconPassword, state.settings.remotePassword, ...state.presets.flatMap(p => [p.settings.password, p.settings.adminPassword, p.settings.rconPassword, p.settings.remotePassword])]);
  };
  refreshSecrets();
  const state = () => {
    const snapshot = store.snapshot();
    return { revision: snapshot.revision, settings: snapshot.settings,
      presets: snapshot.presets.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
      status: manager.status(), live: monitor.snapshot(), network: hostingInfo(manager.child ? manager.activeSettings : snapshot.settings), demo, platform: process.platform, node: process.version,
      pendingRestart: Boolean(manager.child && JSON.stringify(manager.activeSettings) !== JSON.stringify(snapshot.settings)),
      paths: { data: dir, profiles: manager.profilesDir, config: manager.configFile } };
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const send = (code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); };
    try {
      const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!allowedHosts.includes(req.headers.host)) throw new AppError('Untrusted Host header. Open the link printed by the launcher.', 403);
      const origin = req.headers.origin;
      if (origin && !allowedHosts.some(host => origin === `http://${host}`)) throw new AppError('Cross-origin requests are blocked.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('Cross-site requests are blocked.', 403);
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      if (url.pathname.startsWith('/api/')) {
        const supplied = req.headers['x-arma-token'];
        if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) throw new AppError('Session key missing or expired. Open the full private link in the launcher console.', 401);
        if (closing) throw new AppError('Application is shutting down.', 503);
        const route = `${req.method} ${url.pathname}`;
        if (route === 'GET /api/state') return send(200, state());
        if (route === 'GET /api/network') return send(200, hostingInfo(manager.child ? manager.activeSettings : store.snapshot().settings));
        if (route === 'GET /api/live') return send(200, monitor.snapshot());
        if (route === 'GET /api/logs') {
          const after = Number(url.searchParams.get('after') || 0);
          if (!Number.isSafeInteger(after) || after < 0) throw new AppError('Invalid log cursor.');
          return send(200, logs.since(after));
        }
        if (route === 'GET /api/logs/export') return send(200, { text: logs.text() });
        if (route === 'GET /api/preview') {
          const saved = store.snapshot().settings;
          const active = manager.child ? { ...manager.activeSettings, gameExe: saved.gameExe } : saved;
          return send(200, { server: displayCommand(saved.serverExe, serverArgs(saved, manager)),
            client: displayCommand(active.gameExe, clientArgs(active)), config: renderConfig(saved, true),
            clientUsesActive: Boolean(manager.child) });
        }
        if (req.method !== 'POST') throw new AppError('API endpoint not found.', 404);
        const body = await jsonBody(req);
        if (route === 'POST /api/config') {
          const settings = validateSettings(body.settings); logs.setSecrets([settings.password, settings.adminPassword, settings.rconPassword, settings.remotePassword]);
          await store.saveSettings(settings, body.revision); logs.add('Configuration saved. A running server keeps its active settings until restart.');
          return send(200, state());
        }
        if (route === 'POST /api/presets/create') await store.createPreset(body.name, body.revision);
        else if (route === 'POST /api/presets/load') await store.loadPreset(body.id, body.revision);
        else if (route === 'POST /api/presets/delete') await store.deletePreset(body.id, body.revision);
        else if (route === 'POST /api/discover') return send(200, await discoverInstallations());
        else if (route === 'POST /api/missions/scan') return send(200, await scanMissions(store.snapshot().settings.serverExe));
        else if (route === 'POST /api/mods/scan') return send(200, await scanMods(store.snapshot().settings.modRoots));
        else if (route === 'POST /api/diagnostics') return send(200, await diagnostics(store.snapshot().settings, dir, demo, { running: Boolean(manager.child) }));
        else if (route === 'POST /api/live/check') return send(200, await monitor.refresh());
        else if (route === 'POST /api/live/message') return send(200, await monitor.broadcast(body.message));
        else if (route === 'POST /api/server/query') return send(200, await manager.query());
        else if (route === 'POST /api/server/start') await manager.start(store.snapshot().settings);
        else if (route === 'POST /api/server/stop') await manager.stop();
        else if (route === 'POST /api/server/restart') await manager.restart(store.snapshot().settings);
        else if (route === 'POST /api/game/join') return send(200, await manager.join(store.snapshot().settings));
        else if (route === 'POST /api/game/join-remote') return send(200, await manager.joinRemote(store.snapshot().settings));
        else if (route === 'POST /api/quit') {
          send(200, { message: 'Stopping the managed server and closing Local Host.' });
          setTimeout(() => { void close().then(() => onQuit?.()).catch(error => console.error('Shutdown error:', error.message)); }, 80);
          return;
        }
        else throw new AppError('API endpoint not found.', 404);
        refreshSecrets(); return send(200, state());
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('Method not allowed.', 405);
      const asset = ASSETS.get(url.pathname);
      if (!asset) throw new AppError('Not found.', 404);
      const content = await readFile(path.join(root, 'public', asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1] }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) logs.add(`Application error: ${error.message}`);
      if (!res.headersSent && !res.destroyed) send(status, { error: logs.scrub(error.message || 'Unexpected application error.') });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  server.maxHeadersCount = 40;
  server.on('clientError', (_err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  actualPort = server.address().port;
  logs.add(demo ? 'Local Host dashboard started in DEMO mode. No game is running.' : 'Local Host dashboard started. Configure and save installation paths before hosting.');
  async function close(options) {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      monitor.close();
      await manager.close(options);
      await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    })();
    return closePromise;
  }
  return { server, store, manager, monitor, logs, token, url: `http://127.0.0.1:${actualPort}`, close };
}
