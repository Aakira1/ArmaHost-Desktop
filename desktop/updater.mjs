import { mkdir, open, rm, readFile, readdir, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const api = 'https://api.github.com/repos/Aakira1/ArmaHost-Desktop';
export const releasesUrl = 'https://github.com/Aakira1/ArmaHost-Desktop/releases/latest';
export function newerVersion(tag, current) {
  if (!/^v?\d+\.\d+\.\d+$/.test(tag)) return false;
  const a = tag.replace(/^v/, '').split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function releaseAsset(release, portable) {
  const version = release.tag_name.replace(/^v/, '');
  const name = portable ? `ArmaHost-Desktop-Portable-${version}.exe` : `ArmaHost.Desktop.Setup.${version}.exe`;
  const asset = release.assets?.find(a => a.name === name);
  if (!asset || !Number.isSafeInteger(asset.id) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 500 * 1024 * 1024) throw new Error('No compatible Windows download is available.');
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('Release has no verified SHA-256 checksum. Open GitHub Releases instead.');
  return asset;
}
// Release notes are shown as plain text only.
export function releaseNotes(body) { return String(body || '').replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 4096); }
async function sha256(file) { const hash = createHash('sha256'); const handle = await open(file, 'r'); try { for await (const chunk of handle.createReadStream()) hash.update(chunk); } finally { await handle.close().catch(() => {}); } return 'sha256:' + hash.digest('hex'); }

export class DesktopUpdater {
  constructor({ version, dir, portable = false, fetcher = fetch }) { this.version = version; this.dir = dir; this.portable = portable; this.fetcher = fetcher; this.release = null; this.token = ''; this.busy = false; }
  headers() { return { Accept: 'application/vnd.github+json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }; }
  async check(token = '') {
    if (this.busy) throw new Error('An update download is already in progress.');
    this.release = null;
    if (typeof token !== 'string' || token.length > 512 || /[\s\x00-\x1f]/.test(token)) throw new Error('Invalid GitHub token.');
    this.token = token;
    const response = await this.fetcher(api + '/releases/latest', { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    if (response.status === 404 || response.status === 401 || response.status === 403) throw new Error('GitHub release access is unavailable right now. Try again later, or open Releases in your browser.');
    if (!response.ok) throw new Error(`GitHub update check failed (${response.status}).`);
    const release = await response.json();
    if (!newerVersion(release.tag_name, this.version)) return { available: false, message: `You are up to date (${this.version}).` };
    const asset = releaseAsset(release, this.portable);
    this.release = { asset, version: release.tag_name.replace(/^v/, ''), notes: releaseNotes(release.body) };
    return { available: true, version: this.release.version, notes: this.release.notes, size: asset.size, message: `${release.tag_name} is available (${Math.ceil(asset.size / 1048576)} MB).` };
  }
  // Downloads into `dir` (default: this.dir), verifying size and SHA-256 before the file gets its final name.
  // An existing file with the right checksum is reused instead of downloading again.
  async download({ dir = this.dir, onProgress = () => {} } = {}) {
    if (this.busy || !this.release) throw new Error('Check for an available update first.');
    this.busy = true;
    const { asset } = this.release;
    const target = path.join(dir, asset.name); let file;
    try {
      await mkdir(dir, { recursive: true });
      try { if ((await stat(target)).size === asset.size && await sha256(target) === asset.digest) { onProgress(asset.size, asset.size); return target; } } catch { /* Not downloaded yet. */ }
      let response = await this.fetcher(api + `/releases/assets/${asset.id}`, { headers: { ...this.headers(), Accept: 'application/octet-stream' }, redirect: 'manual', signal: AbortSignal.timeout(600000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const url = new URL(response.headers.get('location'));
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.githubusercontent.com')) throw new Error('Unexpected GitHub download location.');
        response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(600000) });
      }
      if (!response.ok || !response.body) throw new Error('Update download failed. Check your connection and try again.');
      file = await open(target + '.part', 'w'); const hash = createHash('sha256'); let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > asset.size) throw new Error('Update exceeded its expected size.'); hash.update(chunk); await file.write(chunk); onProgress(size, asset.size); }
      await file.close(); file = null;
      if (size !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest) throw new Error('Update checksum verification failed.');
      await rename(target + '.part', target);
      return target;
    } catch (error) { await file?.close(); await rm(target + '.part', { force: true }); throw error; }
    finally { this.busy = false; }
  }
}

// How to apply a verified update. Installer builds run the NSIS setup silently into the existing
// install folder and relaunch; portable builds start the new portable executable.
export function installPlan({ file, portable }) {
  return portable ? { command: file, args: [], kind: 'portable' } : { command: file, args: ['/S', '--force-run'], kind: 'installer' };
}

// Background updater: checks on a schedule, downloads and verifies a newer release, then reports
// `ready` so the UI can offer a one-click restart. It never installs without the user's confirmation.
export class UpdateService {
  constructor({ updater, stateFile, downloadDir = updater.dir, firstDelayMs = 15000, intervalMs = 6 * 3600 * 1000, timers = { setTimeout, clearTimeout }, now = () => Date.now() }) {
    Object.assign(this, { updater, stateFile, downloadDir, firstDelayMs, intervalMs, timers, now });
    this.listeners = new Set(); this.timer = null; this.running = null;
    this.prefs = { autoCheck: true, skipped: '' };
    this.state = { status: 'idle', version: updater.version, portable: updater.portable, autoCheck: true, checkedAt: null };
  }
  onState(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  set(patch) { this.state = { ...this.state, ...patch, autoCheck: this.prefs.autoCheck, skipped: this.prefs.skipped }; for (const l of this.listeners) { try { l(this.state); } catch { /* UI listener errors must not stop updates. */ } } }
  async load() {
    try { const saved = JSON.parse(await readFile(this.stateFile, 'utf8')); this.prefs = { autoCheck: saved.autoCheck !== false, skipped: typeof saved.skipped === 'string' ? saved.skipped.slice(0, 20) : '' }; } catch { /* Defaults. */ }
    this.set({});
  }
  async save() { await mkdir(path.dirname(this.stateFile), { recursive: true }); await writeFile(this.stateFile, JSON.stringify(this.prefs)); }
  start() { this.schedule(this.firstDelayMs); }
  stop() { this.timers.clearTimeout(this.timer); this.timer = null; }
  schedule(ms) { this.stop(); if (!this.prefs.autoCheck) return; this.timer = this.timers.setTimeout(() => { this.timer = null; void this.check({ automatic: true }).finally(() => this.schedule(this.intervalMs)); }, ms); this.timer?.unref?.(); }
  async setAutoCheck(value) { this.prefs.autoCheck = value === true; await this.save(); this.set({}); if (this.prefs.autoCheck) this.schedule(this.firstDelayMs); else this.stop(); return this.state; }
  async skip(version) { this.prefs.skipped = String(version || ''); await this.save(); if (this.state.status === 'ready' && this.state.available === this.prefs.skipped) this.set({ status: 'skipped' }); return this.state; }
  check({ automatic = false, token = '' } = {}) {
    if (this.running) return this.running;
    this.running = (async () => {
      if (this.state.status === 'ready') return this.state; // Already downloaded; nothing new to do until installed.
      this.set({ status: 'checking', error: null });
      try {
        const result = await this.updater.check(token);
        const checkedAt = new Date(this.now()).toISOString();
        if (!result.available) { this.set({ status: 'upToDate', checkedAt, available: null }); return this.state; }
        if (automatic && result.version === this.prefs.skipped) { this.set({ status: 'skipped', checkedAt, available: result.version, notes: result.notes }); return this.state; }
        this.set({ status: 'downloading', checkedAt, available: result.version, notes: result.notes, received: 0, total: result.size });
        let last = 0;
        const file = await this.updater.download({ dir: this.downloadDir, onProgress: (received, total) => { if (received === total || received - last > total / 50) { last = received; this.set({ received, total }); } } });
        await this.cleanup(path.basename(file));
        this.set({ status: 'ready', file, received: result.size });
        return this.state;
      } catch (error) {
        this.set({ status: 'error', error: error.message, checkedAt: new Date(this.now()).toISOString() });
        return this.state;
      } finally { this.running = null; }
    })();
    return this.running;
  }
  // Remove old downloads (previous versions, abandoned partial files) from our own updates folder only.
  async cleanup(keep) {
    if (path.resolve(this.downloadDir) !== path.resolve(this.updater.dir)) return;
    for (const name of await readdir(this.updater.dir).catch(() => [])) {
      if (name !== keep && /^ArmaHost(?:\.Desktop\.Setup|-Desktop-Portable)[-.][\d.]+\.exe(?:\.part)?$/.test(name)) await rm(path.join(this.updater.dir, name), { force: true });
    }
  }
}
