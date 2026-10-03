const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.ACCOUNT_DATA_DIR
  ? path.resolve(process.env.ACCOUNT_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'announcements.json');
const TMP = path.join(DATA_DIR, 'announcements.tmp.json');

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) return { version: 1, items: [] };
  try { return { version: 1, items: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch { throw new Error('公告数据文件损坏，请先备份 data/announcements.json'); }
}

let store = load();

function persist() {
  fs.writeFileSync(TMP, JSON.stringify(store, null, 2));
  fs.renameSync(TMP, FILE);
}

function list({ activeOnly = false } = {}) {
  return store.items
    .filter(item => !activeOnly || item.active !== false)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .map(item => ({ ...item }));
}

function create({ title, content, level = 'info' }, authorId) {
  const cleanTitle = String(title || '').trim().slice(0, 60);
  const cleanContent = String(content || '').trim().slice(0, 500);
  if (!cleanTitle || !cleanContent) throw Object.assign(new Error('公告标题和内容不能为空'), { statusCode: 400 });
  const item = {
    id: `notice-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    title: cleanTitle,
    content: cleanContent,
    level: ['info', 'warning', 'success'].includes(level) ? level : 'info',
    active: true,
    authorId: String(authorId || ''),
    createdAt: Date.now(),
  };
  store.items.unshift(item);
  store.items = store.items.slice(0, 100);
  persist();
  return { ...item };
}

function remove(id) {
  const before = store.items.length;
  store.items = store.items.filter(item => item.id !== id);
  if (store.items.length === before) return false;
  persist();
  return true;
}

module.exports = { list, create, remove };
