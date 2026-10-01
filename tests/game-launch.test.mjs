import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLaunch, parseArmaProcesses } from '../src/game-launch.mjs';
import { defaults } from '../src/config.mjs';
test('BattlEye join uses official bootstrap with game and connection arguments', () => {
  const plan = gameLaunch({ ...defaults(), gameExe: 'C:/Arma/arma3_x64.exe' });
  assert.match(plan.exe, /arma3battleye.exe$/i);
  assert.deepEqual(plan.args.slice(0, 5), ['2', '1', '0', '-exe', 'arma3_x64.exe']);
  assert.ok(plan.args.includes('-connect=127.0.0.1'));
  const direct = gameLaunch({ ...defaults(), gameExe: 'C:/Arma/arma3.exe', battleye: false });
  assert.equal(direct.exe, 'C:/Arma/arma3.exe');
});
test('process inventory identifies clients and servers without treating launcher as a game', () => {
  const rows = parseArmaProcesses('"arma3_x64.exe","100","Console","1","200 K"\n"arma3server_x64.exe","200","Console","1","300 K"\n"arma3launcher.exe","300","Console","1","100 K"');
  assert.deepEqual(rows.games.map(p => p.pid), [100]);
  assert.deepEqual(rows.servers.map(p => p.pid), [200]);
  assert.deepEqual(rows.launchers.map(p => p.pid), [300]);
  const more = parseArmaProcesses('"Arma3BattlEye.exe","400","Console","1","9 K"\n"arma3.exe","500","Console","1","9 K"\n"notarma3.exe","600","Console","1","9 K"');
  assert.deepEqual(more.battleye.map(p => p.pid), [400]); assert.deepEqual(more.games.map(p => p.pid), [500]);
});
