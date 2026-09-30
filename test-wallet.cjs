const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-wallet-'));
process.env.WALLET_DATA_DIR = testDir;
process.env.WALLET_STARTING_CREDITS = '100';
process.env.PRICE_GPT_IMAGE_2_STANDARD = '20';

try {
  const wallet = require('./src/wallet');
  const price = wallet.quote({ model: 'GPT Image 2', resolution: 'standard', count: 2 });
  assert.equal(price.total, 40);
  const held = wallet.reserve('request-1', price);
  assert.equal(wallet.publicWallet().available, 60);
  wallet.attachTasks(held.reservation.id, ['task-a', 'task-b']);
  wallet.settleTask('task-a', true);
  assert.deepEqual(wallet.publicWallet(), { balance: 80, reserved: 20, available: 60 });
  wallet.settleTask('task-b', false);
  assert.deepEqual(wallet.publicWallet(), { balance: 80, reserved: 0, available: 80 });
  assert.equal(wallet.reserve('request-1', price).duplicate, true);
  assert.equal(wallet.recentLedger().filter(x => x.type === 'charge').length, 1);
  assert.equal(wallet.recentLedger().filter(x => x.type === 'release').length, 1);
  const agentEstimate = wallet.quote({ model: 'Agent · GPT 5.5 Compact · Instant', count: 1 });
  assert.equal(agentEstimate.billing, 'usage');
  const agentHold = wallet.reserve('agent-request', { ...agentEstimate, unit: 50, total: 50 });
  wallet.attachTasks(agentHold.reservation.id, [{ taskId: 'agent-task', taskApi: 'agent' }]);
  wallet.settleVariableTask('agent-task', true, 8, { usage: { input_tokens: 2000, output_tokens: 1000 } });
  assert.deepEqual(wallet.publicWallet(), { balance: 72, reserved: 0, available: 72 });
  const timeoutPrice = wallet.quote({ model: 'GPT Image 2', resolution: 'standard', count: 1 });
  const timeoutHold = wallet.reserve('timeout-request', timeoutPrice);
  wallet.attachTasks(timeoutHold.reservation.id, [{ taskId: 'timeout-task', taskApi: 'otterl' }]);
  const timeoutResult = wallet.releaseExpiredTasks(1000, Date.now() + 2000);
  assert.equal(timeoutResult.releasedTasks, 1);
  assert.equal(timeoutResult.releasedPoints, 20);
  assert.deepEqual(wallet.publicWallet(), { balance: 72, reserved: 0, available: 72 });
  const orphanHold = wallet.reserve('orphan-request', timeoutPrice);
  const orphanResult = wallet.releaseExpiredTasks(1000, Date.now() + 2000);
  assert.equal(orphanResult.releasedReservations, 1);
  assert.equal(orphanResult.releasedPoints, 20);
  assert.deepEqual(wallet.publicWallet(), { balance: 72, reserved: 0, available: 72 });
  console.log('PASS: billing, reserve, charge, refund, timeout release and idempotency.');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
