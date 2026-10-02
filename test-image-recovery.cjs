const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-image-recovery-'));
process.env.OTTERL_API_KEY = 'test-key';
process.env.WALLET_DATA_DIR = path.join(tempRoot, 'data');
process.env.GENERATED_DIR = path.join(tempRoot, 'generated');

const testPngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
testPngBuffer.writeUInt32BE(1024, 16);
testPngBuffer.writeUInt32BE(1024, 20);
const oneKTestPng = testPngBuffer.toString('base64');
const twoKTestPngBuffer = Buffer.from(testPngBuffer);
twoKTestPngBuffer.writeUInt32BE(2048, 16);
twoKTestPngBuffer.writeUInt32BE(2048, 20);
const twoKTestPng = twoKTestPngBuffer.toString('base64');
let geminiPayload = null;

const fake = http.createServer((req, res) => {
  if (req.url === '/v1/images/generations') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: oneKTestPng }], usage: { total_tokens: 17 } }));
    return;
  }
  if (req.url === '/v1beta/models/gemini-3-pro-image-preview:generateContent') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      geminiPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: twoKTestPng } }] } }],
        usageMetadata: { totalTokenCount: 31 },
      }));
    });
    return;
  }
  res.writeHead(404).end();
});

async function waitForSuccess(provider, taskId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const task = await provider.getTask(taskId);
    if (task.state === 'success') return task;
    if (task.state === 'fail') throw new Error(task.failMsg || task.failCode);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('测试任务等待超时');
}

fake.listen(0, '127.0.0.1', async () => {
  try {
    process.env.OTTERL_BASE_URL = `http://127.0.0.1:${fake.address().port}/v1`;
    const modulePath = require.resolve('./src/providers/otterl-image');
    const provider = require(modulePath);
    const created = await provider.createImageTask({
      modelName: 'GPT Image 2.5 Flare',
      prompt: 'recovery test',
      aspectRatio: '1:1',
      resolution: 'standard',
    });
    const completed = await waitForSuccess(provider, created.taskId);
    assert.strictEqual(completed.state, 'success');
    assert.match(completed.resultUrls[0], /^\/generated\//);
    const generatedName = decodeURIComponent(completed.resultUrls[0].split('/').pop());
    assert.ok(fs.existsSync(path.join(process.env.GENERATED_DIR, generatedName)));

    delete require.cache[modulePath];
    const restartedProvider = require(modulePath);
    const recovered = await restartedProvider.getTask(created.taskId);
    assert.strictEqual(recovered.state, 'success');
    assert.deepStrictEqual(recovered.resultUrls, completed.resultUrls);

    const geminiCreated = await restartedProvider.createImageTask({
      modelName: 'Gemini 3 Pro Image',
      prompt: 'two k test',
      aspectRatio: '16:9',
      resolution: '2K',
    });
    const geminiCompleted = await waitForSuccess(restartedProvider, geminiCreated.taskId);
    assert.strictEqual(geminiCompleted.state, 'success');
    assert.strictEqual(geminiCompleted.outputWidth, 2048);
    assert.strictEqual(geminiPayload.generationConfig.imageConfig.imageSize, '2K');
    assert.strictEqual(geminiPayload.generationConfig.imageConfig.aspectRatio, '16:9');
    console.log('image recovery tests passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    fake.close(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  }
});
