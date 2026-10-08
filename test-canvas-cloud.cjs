const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-canvas-cloud-'));
process.env.CANVAS_DATA_DIR = root;
const cloud = require('./src/canvas-cloud');

const first = { format: 'xiaokai-canvas', id: 'p-a', nodes: [{ id: 'a' }] };
cloud.write('user-a', 'project:p-a', first);
assert.deepStrictEqual(cloud.read('user-a', 'project:p-a').value, first);
assert.strictEqual(cloud.read('user-b', 'project:p-a'), null, 'accounts must not share canvas data');

cloud.write('user-b', 'skill-library', [{ name: 'demo.md', content: '# demo' }]);
assert.strictEqual(cloud.read('user-a', 'skill-library'), null, 'skills must be isolated by account');
assert.strictEqual(cloud.remove('user-a', 'project:p-a'), true);
assert.strictEqual(cloud.read('user-a', 'project:p-a'), null);
assert.throws(() => cloud.write('user-a', '../bad', {}), /数据键无效/);

fs.rmSync(root, { recursive: true, force: true });
console.log('PASS: account canvas cloud persistence and isolation.');
