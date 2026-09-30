import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { readdir, stat, open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';

export class LogBook {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'manager.log'); this.entries = []; this.sequence = 0;
    this.secrets = new Set(); this.diskError = null;
    this.bytes = existsSync(this.file) ? statSync(this.file).size : 0;
  }
  setSecrets(values) { for (const value of values) if (typeof value === 'string' && value) this.secrets.add(value); }
  scrub(value) {
    let message = String(value).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) message = message.split(secret).join('[REDACTED]');
    return message;
  }
  add(raw, source = 'app') {
    for (const line of this.scrub(raw).split(/\r?\n/).slice(0, 200)) {
      if (!line.trim()) continue;
      const entry = { id: ++this.sequence, time: new Date().toISOString(), source, message: line.slice(0, 4096) };
      this.entries.push(entry);
      if (this.entries.length > 1000) this.entries.shift();
      const output = `${entry.time} [${source}] ${entry.message}\n`;
      try {
        if (this.bytes + Buffer.byteLength(output) > 2 * 1024 * 1024) {
          if (existsSync(this.file)) renameSync(this.file, `${this.file}.1`);
          this.bytes = 0;
        }
        appendFileSync(this.file, output, { mode: 0o600 }); this.bytes += Buffer.byteLength(output);
      } catch (error) { this.diskError = error.message; }
    }
  }
  since(after) {
    return { entries: this.entries.filter(e => e.id > after), cursor: this.sequence,
      truncated: Boolean(after && this.entries[0]?.id > after + 1), diskError: this.diskError };
  }
  text() { return this.entries.map(e => `${e.time} [${e.source}] ${e.message}`).join('\n'); }
}
export class RptTail {
  constructor(dir, logs, since, extension = /\.rpt$/i, source = 'rpt') { this.dir = dir; this.logs = logs; this.since = since; this.files = new Map(); this.busy = false; this.extension = extension; this.source = source; }
  poll() {
    if (this.pending) return this.pending;
    const task = this.read(); this.pending = task;
    void task.finally(() => { if (this.pending === task) this.pending = null; });
    return task;
  }
  async read() {
    if (this.busy) return;
    this.busy = true;
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      for (const entry of entries.filter(e => e.isFile() && this.extension.test(e.name)).slice(-20)) {
        const file = path.join(this.dir, entry.name);
        const info = await stat(file);
        if (info.mtimeMs < this.since) continue;
        let cursor = this.files.get(file);
        if (!cursor || info.size < cursor.offset) {
          cursor = { offset: Math.max(0, info.size - 65536), partial: '', decoder: new StringDecoder('utf8') };
          this.files.set(file, cursor);
        }
        if (info.size <= cursor.offset) continue;
        const fd = await open(file, 'r');
        try {
          const buffer = Buffer.alloc(Math.min(65536, info.size - cursor.offset));
          const { bytesRead } = await fd.read(buffer, 0, buffer.length, cursor.offset);
          cursor.offset += bytesRead;
          const text = cursor.partial + cursor.decoder.write(buffer.subarray(0, bytesRead));
          const lines = text.split(/\r?\n/);
          cursor.partial = lines.pop().slice(-8192);
          for (const line of lines) this.logs.add(line, this.source);
        } finally { await fd.close(); }
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && this.lastError !== error.message) { this.logs.add(`RPT reader: ${error.message}`); this.lastError = error.message; }
    } finally { this.busy = false; }
  }
}
