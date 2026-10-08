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
  assert.equal(wallet.hasTask('task-a'), true);
  assert.equal(wallet.runAs('different-user', () => wallet.hasTask('task-a')), false);
  wallet.settleTask('task-a', true);
  assert.deepEqual(wallet.publicWallet(), { balance: 80, reserved: 20, available: 60 });
  wallet.settleTask('task-b', false);
  assert.deepEqual(wallet.publicWallet(), { balance: 80, reserved: 0, available: 80 });
  assert.equal(wallet.reserve('request-1', price).duplicate, true);
  assert.equal(wallet.recentLedger().filter(x => x.type === 'charge').length, 1);
  assert.equal(wallet.recentLedger().filter(x => x.type === 'release').length, 1);
  const agentEstimate = wallet.quote({ model: 'Agent · GPT 5.5 Vision · 省积分', count: 1 });
  assert.equal(agentEstimate.billing, 'usage');
  const agentHold = wallet.reserve('agent-request', { ...agentEstimate, unit: 50, total: 50 });
  wallet.attachTasks(agentHold.reservation.id, [{ taskId: 'agent-task', taskApi: 'agent' }]);
  wallet.settleVariableTask('agent-task', true, 8, {
    usage: { input_tokens: 2000, output_tokens: 1000 },
    resultText: '这是需要在刷新后找回的 Agent 回答。',
    agentModel: 'GPT 5.5 Vision · 省积分',
    providerModel: 'gpt-5.5-chat',
    quote: { total: 8, totalRmb: 0.08 },
  });
  assert.deepEqual(wallet.publicWallet(), { balance: 72, reserved: 0, available: 72 });
  assert.equal(wallet.taskByRequest('agent-request').resultText, '这是需要在刷新后找回的 Agent 回答。');
  assert.equal(wallet.recentAgentResults(10)[0].text, '这是需要在刷新后找回的 Agent 回答。');
  assert.equal(wallet.recentAgentResults(10)[0].requestId, 'agent-request');
  assert.equal(wallet.recentLedger().find(x => x.type === 'charge').meta.resultText, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(testDir, 'wallet.json'), 'utf8')).tasks['agent-task'].resultText, '这是需要在刷新后找回的 Agent 回答。');
  const failedAgentHold = wallet.reserve('agent-fail-request', { ...agentEstimate, unit: 10, total: 10 });
  wallet.attachTasks(failedAgentHold.reservation.id, [{ taskId: 'agent-fail-task', taskApi: 'agent' }]);
  wallet.settleVariableTask('agent-fail-task', false, 0, { error: '模型接口暂时不可用' });
  assert.equal(wallet.taskByRequest('agent-fail-request').error, '模型接口暂时不可用');
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
  wallet.runAs('agent-overage-user', () => {
    wallet.grant(5, 'Agent 超额结算测试');
    const overageHold = wallet.reserve('agent-overage-request', { ...agentEstimate, unit: 5, total: 5 });
    wallet.attachTasks(overageHold.reservation.id, [{ taskId: 'agent-overage-task', taskApi: 'agent' }]);
    wallet.settleVariableTask('agent-overage-task', true, 12, { resultText: '已生成内容' });
    assert.deepEqual(wallet.publicWallet(), { balance: -7, reserved: 0, available: 0 });
    assert.equal(wallet.recentLedger().find(x => x.type === 'charge').amount, -12);
  });
  console.log('PASS: billing, persisted Agent results, reserve, charge, refund, timeout release and idempotency.');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
