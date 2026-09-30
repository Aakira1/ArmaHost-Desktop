import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults, validateSettings, clientArgs, displayCommand } from '../src/config.mjs';
import { ProcessManager } from '../src/process-manager.mjs';
import { LogBook } from '../src/logs.mjs';
test('friend connection validates host and port and redacts passwords', () => {
  const s = validateSettings({ ...defaults(), remoteHost: 'friend.example.com', remotePort: 2402, remotePassword: 'friend-secret' });
  const args = clientArgs(s, { host: s.remoteHost, port: s.remotePort, password: s.remotePassword });
  assert.ok(args.includes('-connect=friend.example.com')); assert.ok(args.includes('-port=2402'));
  assert.ok(!displayCommand('arma3.exe', args).includes('friend-secret'));
  for (const remoteHost of ['https://example.com', 'a;calc', '-flag', 'host\ncommand']) assert.throws(() => validateSettings({ ...defaults(), remoteHost }));
  assert.throws(() => validateSettings({ ...defaults(), remotePort: 0 }));
});
test('joining a friend does not need a local server and never starts one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arma-join-'));
  const manager = new ProcessManager({ dir, logs: new LogBook(dir), demo: true });
  try {
    await assert.rejects(manager.joinRemote(defaults()), /address/i);
    const result = await manager.joinRemote(validateSettings({ ...defaults(), remoteHost: '8.8.8.8' }));
    assert.match(result.message, /Demo/); assert.equal(manager.child, null);
    await assert.rejects(manager.joinRemote(validateSettings({ ...defaults(), remoteHost: '8.8.8.8' })), /just requested/i);
  } finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
});
