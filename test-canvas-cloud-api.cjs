const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-canvas-api-'));
let child;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
}

async function json(base, url, options = {}) {
  const response = await fetch(base + url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

(async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: root,
      ACCOUNT_DATA_DIR: root,
      WALLET_DATA_DIR: root,
      CANVAS_DATA_DIR: root,
      GENERATED_DIR: path.join(root, 'generated'),
      ADMIN_USERNAME: 'cloud_api_admin',
      ADMIN_PASSWORD: 'CloudApiAdmin!123',
      ACCOUNT_SIGNUP_CREDITS: '0',
    },
  });
  await waitForServer(base);

  const stamp = Date.now();
  const a = await json(base, '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `cloud_a_${stamp}`, password: 'CloudUser!123', displayName: '云画布甲' }),
  });
  assert.strictEqual(a.response.status, 200);
  const b = await json(base, '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `cloud_b_${stamp}`, password: 'CloudUser!123', displayName: '云画布乙' }),
  });
  assert.strictEqual(b.response.status, 200);

  const canvas = { format: 'xiaokai-canvas', id: 'p-cloud', name: '跨电脑项目', nodes: [] };
  const put = await json(base, '/api/canvas-cloud', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ key: 'current', value: canvas }),
  });
  assert.strictEqual(put.response.status, 200);
  const getA = await json(base, '/api/canvas-cloud?key=current', { headers: { Cookie: a.cookie } });
  assert.deepStrictEqual(getA.data.value, canvas);
  const getB = await json(base, '/api/canvas-cloud?key=current', { headers: { Cookie: b.cookie } });
  assert.strictEqual(getB.response.status, 404, 'another account must not see account A canvas');
  const anonymous = await json(base, '/api/canvas-cloud?key=current');
  assert.strictEqual(anonymous.response.status, 401, 'cloud canvas must require authentication');

  console.log('PASS: authenticated canvas cloud API saves and isolates accounts.');
})().finally(() => {
  if (child && !child.killed) child.kill();
  fs.rmSync(root, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
