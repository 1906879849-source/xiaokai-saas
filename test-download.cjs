const path = require('path');

const root = path.join(__dirname, '.download-test');
process.env.PORT = '4399';
process.env.DATA_DIR = path.join(root, 'data');
process.env.GENERATED_DIR = path.join(root, 'generated');
process.env.FIRST_USER_IS_ADMIN = 'true';

const accounts = require('./src/accounts');
const wallet = require('./src/wallet');
const mockImage = require('./src/providers/mock-image');

(async () => {
  const username = `download_${Date.now()}`;
  const user = accounts.register({ username, password: 'Test123456!', displayName: '下载测试' });
  const token = accounts.createSession(user.id);
  const created = await mockImage.createImageTask({ prompt: 'download test', aspectRatio: '3:2', resolution: '1K' });
  wallet.runAs(user.id, () => {
    wallet.grant(100, '下载测试积分');
    const { reservation } = wallet.reserve(`download-${Date.now()}`, { model: 'test-image', count: 1, unit: 1, total: 1 });
    wallet.attachTasks(reservation.id, [{ taskId: created.taskId, taskApi: 'mock', model: 'test-image' }]);
  });
  require('./server');
  await new Promise(resolve => setTimeout(resolve, 1700));
  const response = await fetch(`http://127.0.0.1:4399/api/task/${encodeURIComponent(created.taskId)}/image?api=mock`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${buffer.toString('utf8')}`);
  if (!String(response.headers.get('content-type') || '').includes('image/svg+xml')) throw new Error('下载接口没有返回图片类型');
  if (!buffer.toString('utf8').startsWith('<svg')) throw new Error('下载内容不是图片');
  console.log(`PASS: generated-image download returned ${buffer.length} bytes (${response.headers.get('content-type')}).`);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
