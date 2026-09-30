import { mkdir, open, rm } from 'node:fs/promises';
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
export class DesktopUpdater {
  constructor({ version, dir, portable = false, fetcher = fetch }) { this.version = version; this.dir = dir; this.portable = portable; this.fetcher = fetcher; this.release = null; this.token = ''; this.busy = false; }
  headers() { return { Accept: 'application/vnd.github+json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }; }
  async check(token = '') {
    if (this.busy) throw new Error('An update download is already in progress.');
    this.release = null;
    if (typeof token !== 'string' || token.length > 512 || /[\s\x00-\x1f]/.test(token)) throw new Error('Invalid GitHub token.');
    this.token = token;
    const response = await this.fetcher(api + '/releases/latest', { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    if (response.status === 404 || response.status === 401 || response.status === 403) throw new Error('GitHub release access is unavailable. For this private repository, enter a GitHub token with Contents read access, or open Releases in your signed-in browser. The token is kept only for this session.');
    if (!response.ok) throw new Error(`GitHub update check failed (${response.status}).`);
    const release = await response.json();
    if (!newerVersion(release.tag_name, this.version)) return { available: false, message: `You are up to date (${this.version}).` };
    const asset = releaseAsset(release, this.portable); this.release = { asset, version: release.tag_name };
    return { available: true, message: `${release.tag_name} is available (${Math.ceil(asset.size / 1048576)} MB).` };
  }
  async download() {
    if (this.busy || !this.release) throw new Error('Check for an available update first.');
    this.busy = true;
    const { asset } = this.release;
    const target = path.join(this.dir, asset.name); let file;
    try {
      await mkdir(this.dir, { recursive: true });
      let response = await this.fetcher(api + `/releases/assets/${asset.id}`, { headers: { ...this.headers(), Accept: 'application/octet-stream' }, redirect: 'manual', signal: AbortSignal.timeout(300000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const url = new URL(response.headers.get('location'));
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.githubusercontent.com')) throw new Error('Unexpected GitHub download location.');
        response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(300000) });
      }
      if (!response.ok || !response.body) throw new Error('Update download failed. Check GitHub access and try again.');
      file = await open(target + '.part', 'w'); const hash = createHash('sha256'); let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > asset.size) throw new Error('Update exceeded its expected size.'); hash.update(chunk); await file.write(chunk); }
      await file.close(); file = null;
      if (size !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest) throw new Error('Update checksum verification failed.');
      const { rename } = await import('node:fs/promises'); await rename(target + '.part', target);
      return target;
    } catch (error) { await file?.close(); await rm(target + '.part', { force: true }); throw error; }
    finally { this.busy = false; }
  }
}
