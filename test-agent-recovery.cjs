const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-agent-recovery-'));
const appPort = 43991;
const providerPort = 43992;
let lastProviderPayload = null;
const fakeProvider = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    lastProviderPayload = payload;
    assert.ok(payload.model);
    setTimeout(() => {
      res.setHeader('Content-Type', 'application/json');
      if (body.includes('FORCE_FAIL')) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: { message: '模拟上游失败' } }));
        return;
      }
      res.end(JSON.stringify({
        choices: [{ message: { content: '模拟的 Agent 持久化回答' } }],
        usage: { input_tokens: 120, output_tokens: 40 },
      }));
    }, 250);
  });
});

const listen = server => new Promise((resolve, reject) => server.listen(providerPort, '127.0.0.1', resolve).once('error', reject));
const close = server => new Promise(resolve => server.close(resolve));
const waitForApp = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${appPort}/api/health`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('测试服务没有按时启动');
};

(async () => {
  let child;
  try {
    await listen(fakeProvider);
    child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(appPort),
        NODE_ENV: 'test',
        ACCOUNT_DATA_DIR: path.join(testDir, 'accounts'),
        WALLET_DATA_DIR: path.join(testDir, 'wallet'),
        GENERATED_DIR: path.join(testDir, 'generated'),
        ACCOUNT_SIGNUP_CREDITS: '100',
        OTTERL_API_KEY: 'test-only-key',
        OTTERL_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForApp();
    const register = await fetch(`http://127.0.0.1:${appPort}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'agent-test@example.com', password: 'test-password-123', displayName: 'Agent Test' }),
    });
    assert.equal(register.status, 200);
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const requestId = 'agent-recovery-test-request';
    const run = await fetch(`http://127.0.0.1:${appPort}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': requestId },
      body: JSON.stringify({
        model: 'GPT 5.5 Vision · 省积分',
        metaPrompt: '按完整结构输出',
        userNeed: '测试持久化回答',
        skillName: '测试 SKILL.md',
        skillContent: '# 测试 Skill\n必须输出完整分析、执行步骤和最终文案。',
        images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
      }),
    });
    const accepted = await run.json();
    assert.equal(run.status, 202);
    assert.equal(accepted.accepted, true);
    assert.ok(accepted.taskId);
    let saved;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await fetch(`http://127.0.0.1:${appPort}/api/agent/status?requestId=${requestId}`, { headers: { Cookie: cookie } });
      saved = await status.json();
      if (saved.task?.state !== 'reserved') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(saved.task.state, 'charged');
    assert.equal(saved.task.text, '模拟的 Agent 持久化回答');
    assert.equal(lastProviderPayload.max_completion_tokens, 2048);
    assert.equal(lastProviderPayload.model, 'gpt-5.5');
    assert.equal(lastProviderPayload.messages[1].content[1].image_url.detail, 'low');
    const sentMessages = JSON.stringify(lastProviderPayload.messages || []);
    assert.match(sentMessages, /测试 Skill/);
    assert.match(sentMessages, /不得只复述规则/);
    assert.match(sentMessages, /均为已授权的成年模特商业素材/);
    const chargedBalance = saved.wallet.balance;
    const duplicate = await fetch(`http://127.0.0.1:${appPort}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': requestId },
      body: JSON.stringify({ model: 'GPT 5.5 Vision · 省积分', userNeed: '测试持久化回答' }),
    });
    const recovered = await duplicate.json();
    assert.equal(duplicate.status, 200);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.text, '模拟的 Agent 持久化回答');
    assert.equal(recovered.wallet.balance, chargedBalance);

    const failedRequestId = 'agent-background-failure-request';
    const failedRun = await fetch(`http://127.0.0.1:${appPort}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': failedRequestId },
      body: JSON.stringify({ model: 'GPT 5.5 Vision · 省积分', userNeed: 'FORCE_FAIL' }),
    });
    assert.equal(failedRun.status, 202);
    let failedSaved;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await fetch(`http://127.0.0.1:${appPort}/api/agent/status?requestId=${failedRequestId}`, { headers: { Cookie: cookie } });
      failedSaved = await status.json();
      if (failedSaved.task?.state !== 'reserved') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(failedSaved.task.state, 'released');
    assert.match(failedSaved.task.error, /模拟上游失败/);
    assert.equal(failedSaved.wallet.balance, chargedBalance);
    assert.equal(failedSaved.wallet.reserved, 0);
    console.log('PASS: Agent runs in background, persists after refresh, and is not charged twice.');
  } finally {
    if (child && !child.killed) child.kill();
    await close(fakeProvider).catch(() => {});
    fs.rmSync(testDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
