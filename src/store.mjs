import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError, defaults, validateSettings } from './config.mjs';

export async function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}
export class Store {
  constructor(dir, state) { this.dir = dir; this.state = state; this.queue = Promise.resolve(); }
  static async open(dir) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'state.json');
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
      if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.presets) || state.presets.length > 50) throw new Error('Unsupported state format');
      state.settings = validateSettings(state.settings);
      for (const p of state.presets) {
        if (!/^[a-f0-9-]{36}$/.test(p.id) || typeof p.name !== 'string' || p.name.length > 60) throw new Error('Invalid preset');
        p.settings = validateSettings(p.settings);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot read ${file}. State was NOT overwritten. Restore or rename state.json after backing it up. ${error.message}`);
      state = { version: 1, revision: 0, settings: defaults(), presets: [] };
      await atomicWrite(file, JSON.stringify(state, null, 2));
    }
    return new Store(dir, state);
  }
  snapshot() { return structuredClone(this.state); }
  mutate(revision, operation) {
    const task = this.queue.then(async () => {
      if (!Number.isSafeInteger(revision) || revision !== this.state.revision) throw new AppError('Settings changed in another tab. Reload the dashboard before saving.', 409);
      const next = this.snapshot();
      const result = operation(next);
      next.revision++;
      await atomicWrite(path.join(this.dir, 'state.json'), JSON.stringify(next, null, 2));
      this.state = next;
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  saveSettings(settings, revision) { return this.mutate(revision, next => { next.settings = validateSettings(settings); }); }
  createPreset(name, revision) {
    if (typeof name !== 'string' || !name.trim() || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new AppError('Preset name must contain 1–60 printable characters.');
    return this.mutate(revision, next => {
      if (next.presets.length >= 50) throw new AppError('Maximum 50 presets. Delete one first.');
      if (next.presets.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) throw new AppError('A preset with that name already exists.');
      const p = { id: randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), settings: structuredClone(next.settings) };
      next.presets.push(p);
      return { id: p.id, name: p.name, createdAt: p.createdAt };
    });
  }
  loadPreset(id, revision) {
    return this.mutate(revision, next => {
      const p = next.presets.find(p => p.id === id);
      if (!p) throw new AppError('Preset not found.', 404);
      next.settings = structuredClone(p.settings);
    });
  }
  deletePreset(id, revision) {
    return this.mutate(revision, next => {
      const index = next.presets.findIndex(p => p.id === id);
      if (index < 0) throw new AppError('Preset not found.', 404);
      next.presets.splice(index, 1);
    });
  }
}
