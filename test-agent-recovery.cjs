const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-agent-recovery-'));
const appPort = 43991;
const providerPort = 43992;
const fakeProvider = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    assert.ok(payload.model);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: '模拟的 Agent 持久化回答' } }],
      usage: { input_tokens: 120, output_tokens: 40 },
    }));
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
      body: JSON.stringify({ model: 'GPT 5.5 Compact · Instant', userNeed: '测试持久化回答' }),
    });
    const first = await run.json();
    assert.equal(run.status, 200);
    assert.equal(first.text, '模拟的 Agent 持久化回答');
    const chargedBalance = first.wallet.balance;
    const status = await fetch(`http://127.0.0.1:${appPort}/api/agent/status?requestId=${requestId}`, { headers: { Cookie: cookie } });
    const saved = await status.json();
    assert.equal(saved.task.state, 'charged');
    assert.equal(saved.task.text, '模拟的 Agent 持久化回答');
    const duplicate = await fetch(`http://127.0.0.1:${appPort}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': requestId },
      body: JSON.stringify({ model: 'GPT 5.5 Compact · Instant', userNeed: '测试持久化回答' }),
    });
    const recovered = await duplicate.json();
    assert.equal(duplicate.status, 200);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.text, '模拟的 Agent 持久化回答');
    assert.equal(recovered.wallet.balance, chargedBalance);
    console.log('PASS: Agent response persisted, recovered after refresh, and was not charged twice.');
  } finally {
    if (child && !child.killed) child.kill();
    await close(fakeProvider).catch(() => {});
    fs.rmSync(testDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
