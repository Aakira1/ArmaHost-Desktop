import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessManager } from '../src/process-manager.mjs';
import { createApp } from '../src/http.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
test('desktop disconnect preserves a live server while explicit shutdown stops it', async () => {
  const manager = new ProcessManager({ dir: 'fixture', logs: { add() {} } });
  let stops = 0;
  manager.child = { pid: 123 };
  manager.stop = async () => { stops++; manager.child = null; };
  await manager.close({ leaveRunning: true });
  assert.equal(stops, 0); assert.equal(manager.child.pid, 123);
  await manager.close(); assert.equal(stops, 1);
});
test('desktop shutdown closes orphaned renderer connections instead of hanging', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-close-'));
  const app = await createApp({ root: fileURLToPath(new URL('..', import.meta.url)), dir, demo: true, port: 0 });
  const socket = net.connect(Number(new URL(app.url).port), '127.0.0.1');
  let timer;
  try {
    await once(socket, 'connect'); socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
    await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Shutdown hung')), 1000); })]);
  } finally { clearTimeout(timer); socket.destroy(); await app.close(); await rm(dir, { recursive: true, force: true }); }
});
