const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.ACCOUNT_DATA_DIR
  ? path.resolve(process.env.ACCOUNT_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'accounts.json');
const TMP_FILE = path.join(DATA_DIR, 'accounts.tmp.json');
const RECEIPT_DIR = path.join(DATA_DIR, 'receipts');
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function emptyStore() { return { version: 1, users: {}, usernameIndex: {}, sessions: {}, recharges: {} }; }
function load() {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) return emptyStore();
  try { return { ...emptyStore(), ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }; }
  catch { throw new Error('账号数据文件损坏，请先备份 data/accounts.json'); }
}
let store = load();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TMP_FILE, JSON.stringify(store, null, 2));
  fs.renameSync(TMP_FILE, STORE_FILE);
}

function normalizeUsername(value) { return String(value || '').trim().toLowerCase(); }
function publicUser(user) {
  return user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role, status: user.status, createdAt: user.createdAt } : null;
}
function passwordHash(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString('hex'); }
function cleanSessions() {
  const now = Date.now();
  Object.entries(store.sessions).forEach(([key, session]) => { if (session.expiresAt <= now) delete store.sessions[key]; });
}

function register({ username, password, displayName }) {
  const normalized = normalizeUsername(username);
  if (!/^[\p{L}\p{N}_.@+-]{3,40}$/u.test(normalized)) throw Object.assign(new Error('账号需为 3–40 位，可使用中文、字母、数字、邮箱及 _ . + -'), { statusCode: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('密码至少需要 8 位'), { statusCode: 400 });
  if (store.usernameIndex[normalized]) throw Object.assign(new Error('这个账号已经注册'), { statusCode: 409 });
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const isFirst = Object.keys(store.users).length === 0;
  const defaultFirstUserIsAdmin = String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'false' : 'true';
  const user = {
    id, username: normalized, displayName: String(displayName || username).trim().slice(0, 40) || normalized,
    passwordSalt: salt, passwordHash: passwordHash(password, salt),
    role: isFirst && String(process.env.FIRST_USER_IS_ADMIN || defaultFirstUserIsAdmin).toLowerCase() === 'true' ? 'admin' : 'user',
    status: 'active', createdAt: Date.now(),
  };
  store.users[id] = user;
  store.usernameIndex[normalized] = id;
  persist();
  return publicUser(user);
}

function ensureAdminFromEnv() {
  const username = String(process.env.ADMIN_USERNAME || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!username || !password) return;
  const normalized = normalizeUsername(username);
  const existingId = store.usernameIndex[normalized];
  if (existingId) {
    const existing = store.users[existingId];
    let changed = false;
    if (existing.role !== 'admin') { existing.role = 'admin'; changed = true; }
    // Railway 环境变量是管理员密码的来源。变量修改并重新部署后，
    // 同步更新持久化账号，避免后台一直要求首次创建时的旧密码。
    const configuredHash = passwordHash(password, existing.passwordSalt);
    if (configuredHash !== existing.passwordHash) {
      existing.passwordHash = configuredHash;
      changed = true;
    }
    if (changed) persist();
    return;
  }
  if (password.length < 12) throw new Error('生产环境 ADMIN_PASSWORD 至少需要 12 位');
  const prior = process.env.FIRST_USER_IS_ADMIN;
  process.env.FIRST_USER_IS_ADMIN = 'false';
  const user = register({ username, password, displayName: process.env.ADMIN_DISPLAY_NAME || '管理员' });
  store.users[user.id].role = 'admin';
  if (prior === undefined) delete process.env.FIRST_USER_IS_ADMIN; else process.env.FIRST_USER_IS_ADMIN = prior;
  persist();
}

function authenticate(username, password) {
  const id = store.usernameIndex[normalizeUsername(username)];
  const user = id ? store.users[id] : null;
  if (!user || user.status !== 'active') throw Object.assign(new Error('账号或密码错误'), { statusCode: 401 });
  const actual = Buffer.from(passwordHash(password, user.passwordSalt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw Object.assign(new Error('账号或密码错误'), { statusCode: 401 });
  return publicUser(user);
}

function createSession(userId) {
  cleanSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  const key = crypto.createHash('sha256').update(token).digest('hex');
  store.sessions[key] = { userId, expiresAt: Date.now() + SESSION_TTL, createdAt: Date.now() };
  persist();
  return token;
}
function sessionUser(token) {
  if (!token) return null;
  cleanSessions();
  const key = crypto.createHash('sha256').update(String(token)).digest('hex');
  const session = store.sessions[key];
  const user = session ? store.users[session.userId] : null;
  return user?.status === 'active' ? publicUser(user) : null;
}
function revokeSession(token) {
  if (!token) return;
  const key = crypto.createHash('sha256').update(String(token)).digest('hex');
  delete store.sessions[key]; persist();
}

function saveReceipt(userId, dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP 付款截图'), { statusCode: 400 });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 6 * 1024 * 1024) throw Object.assign(new Error('付款截图不能超过 6MB'), { statusCode: 400 });
  const ext = /png/i.test(match[1]) ? 'png' : /webp/i.test(match[1]) ? 'webp' : 'jpg';
  const name = `${userId}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(RECEIPT_DIR, name), buffer);
  return name;
}

function createRecharge({ userId, amountRmb, channel, payerNote, receiptDataUrl }) {
  const amount = Number(amountRmb);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) throw Object.assign(new Error('充值金额需要在 ¥1–¥100000 之间'), { statusCode: 400 });
  if (!['wechat', 'alipay'].includes(channel)) throw Object.assign(new Error('请选择微信或支付宝'), { statusCode: 400 });
  const receiptFile = receiptDataUrl ? saveReceipt(userId, receiptDataUrl) : '';
  const id = `RC${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const item = { id, userId, amountRmb: Number(amount.toFixed(2)), points: Math.round(amount * 100), channel, payerNote: String(payerNote || '').trim().slice(0, 120), receiptFile, status: 'pending', createdAt: Date.now(), reviewedAt: 0, reviewerId: '', reviewNote: '' };
  store.recharges[id] = item; persist(); return { ...item, receiptFile: undefined };
}
function listRecharges(userId, limit = 30) {
  return Object.values(store.recharges).filter(x => !userId || x.userId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(100, Number(limit) || 30))).map(x => ({ ...x, hasReceipt: Boolean(x.receiptFile), receiptFile: undefined, username: store.users[x.userId]?.username || '未知用户' }));
}
function reviewRecharge(id, { reviewerId, status, reviewNote }) {
  const item = store.recharges[id];
  if (!item) throw Object.assign(new Error('充值申请不存在'), { statusCode: 404 });
  if (item.status !== 'pending') throw Object.assign(new Error('这笔充值已经审核过'), { statusCode: 409 });
  if (!['approved', 'rejected'].includes(status)) throw Object.assign(new Error('审核状态无效'), { statusCode: 400 });
  item.status = status; item.reviewerId = reviewerId; item.reviewedAt = Date.now(); item.reviewNote = String(reviewNote || '').trim().slice(0, 200); persist();
  return { ...item, receiptFile: undefined };
}
function receiptPath(id) {
  const item = store.recharges[id];
  return item?.receiptFile ? path.join(RECEIPT_DIR, item.receiptFile) : '';
}
function listUsers() { return Object.values(store.users).map(publicUser).sort((a, b) => b.createdAt - a.createdAt); }

ensureAdminFromEnv();

if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
  const hasAdmin = Object.values(store.users).some(user => user.role === 'admin' && user.status === 'active');
  if (!hasAdmin) {
    throw new Error('生产环境尚未创建管理员：请配置 ADMIN_USERNAME 和至少 12 位的 ADMIN_PASSWORD。');
  }
}

module.exports = { register, authenticate, createSession, sessionUser, revokeSession, createRecharge, listRecharges, reviewRecharge, receiptPath, listUsers };
