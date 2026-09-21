const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const EMPTY_DB = {
  users: [],
  sessions: [],
  wallets: [],
  transactions: [],
  projects: [],
  taskBills: [],
};

function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return { ...EMPTY_DB, ...parsed };
  } catch {
    saveDb(EMPTY_DB);
    return JSON.parse(JSON.stringify(EMPTY_DB));
  }
}

function saveDb(db) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

function mutate(fn) {
  const db = loadDb();
  const result = fn(db);
  saveDb(db);
  return result;
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, ...rest } = user;
  return rest;
}

function register({ email, password, nickname = '' }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('请输入有效邮箱'), { statusCode: 400 });
  if (String(password || '').length < 6) throw Object.assign(new Error('密码至少 6 位'), { statusCode: 400 });
  return mutate(db => {
    if (db.users.some(u => u.email === email)) throw Object.assign(new Error('该邮箱已经注册'), { statusCode: 409 });
    const { salt, hash } = hashPassword(password);
    const user = {
      id: id('usr'),
      email,
      nickname: String(nickname || '').trim() || email.split('@')[0],
      role: process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.toLowerCase() === email ? 'admin' : 'user',
      status: 'active',
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: Date.now(),
    };
    db.users.push(user);
    db.wallets.push({ userId: user.id, balanceUnits: 0, frozenUnits: 0, updatedAt: Date.now() });
    return safeUser(user);
  });
}

function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const db = loadDb();
  const user = db.users.find(u => u.email === email);
  if (!user || user.status !== 'active') throw Object.assign(new Error('邮箱或密码错误'), { statusCode: 401 });
  const { hash } = hashPassword(password, user.passwordSalt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(user.passwordHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('邮箱或密码错误'), { statusCode: 401 });
  const token = crypto.randomBytes(32).toString('hex');
  mutate(next => {
    next.sessions = next.sessions.filter(s => s.expiresAt > Date.now() && s.userId !== user.id);
    next.sessions.push({ token, userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + 30 * 864e5 });
  });
  return { token, user: safeUser(user) };
}

function userFromToken(token) {
  if (!token) return null;
  const db = loadDb();
  const session = db.sessions.find(s => s.token === token && s.expiresAt > Date.now());
  if (!session) return null;
  return safeUser(db.users.find(u => u.id === session.userId));
}

function wallet(userId) {
  const db = loadDb();
  return db.wallets.find(w => w.userId === userId) || { userId, balanceUnits: 0, frozenUnits: 0 };
}

function recordTransaction(db, tx) {
  const row = { id: id('tx'), createdAt: Date.now(), ...tx };
  db.transactions.unshift(row);
  return row;
}

function addBalance(userId, amountUnits, type = 'topup', description = '') {
  amountUnits = Math.round(Number(amountUnits || 0));
  if (!amountUnits) throw Object.assign(new Error('积分变动不能为 0'), { statusCode: 400 });
  return mutate(db => {
    const w = db.wallets.find(x => x.userId === userId);
    if (!w) throw new Error('钱包不存在');
    if (w.balanceUnits + amountUnits < 0) throw Object.assign(new Error('积分余额不足'), { statusCode: 402 });
    w.balanceUnits += amountUnits;
    w.updatedAt = Date.now();
    recordTransaction(db, { userId, type, amountUnits, balanceAfterUnits: w.balanceUnits, description });
    return { ...w };
  });
}

function reserve(userId, amountUnits, meta = {}) {
  amountUnits = Math.max(0, Math.round(Number(amountUnits || 0)));
  return mutate(db => {
    const w = db.wallets.find(x => x.userId === userId);
    if (!w) throw new Error('钱包不存在');
    if (w.balanceUnits < amountUnits) throw Object.assign(new Error('积分余额不足，请先充值'), { statusCode: 402 });
    w.balanceUnits -= amountUnits;
    w.frozenUnits += amountUnits;
    w.updatedAt = Date.now();
    recordTransaction(db, { userId, type: 'freeze', amountUnits: -amountUnits, balanceAfterUnits: w.balanceUnits, description: meta.description || '生成任务冻结积分', meta });
    return { ...w };
  });
}

function addTaskBill({ taskId, userId, unitCostUnits, model, resolution }) {
  return mutate(db => {
    const existing = db.taskBills.find(x => x.taskId === taskId);
    if (existing) return existing;
    const row = { taskId, userId, unitCostUnits, model, resolution, status: 'pending', createdAt: Date.now() };
    db.taskBills.push(row);
    return row;
  });
}

function settleTaskBill(taskId, state, detail = '') {
  if (!['success', 'fail'].includes(state)) return null;
  return mutate(db => {
    const bill = db.taskBills.find(x => x.taskId === taskId);
    if (!bill || bill.status !== 'pending') return bill || null;
    const w = db.wallets.find(x => x.userId === bill.userId);
    if (!w) return null;
    w.frozenUnits = Math.max(0, w.frozenUnits - bill.unitCostUnits);
    if (state === 'success') {
      bill.status = 'success';
      recordTransaction(db, {
        userId: bill.userId,
        type: 'consume',
        amountUnits: 0,
        balanceAfterUnits: w.balanceUnits,
        description: `${bill.model} ${bill.resolution} 生成成功，消费 ${(bill.unitCostUnits / 10).toFixed(1).replace('.0','')} 积分`,
        meta: { taskId, model: bill.model, resolution: bill.resolution, costUnits: bill.unitCostUnits },
      });
    } else {
      w.balanceUnits += bill.unitCostUnits;
      bill.status = 'fail';
      recordTransaction(db, {
        userId: bill.userId,
        type: 'refund',
        amountUnits: bill.unitCostUnits,
        balanceAfterUnits: w.balanceUnits,
        description: `${bill.model} 生成失败，返还 ${(bill.unitCostUnits / 10).toFixed(1).replace('.0','')} 积分${detail ? ` · ${detail}` : ''}`,
        meta: { taskId, model: bill.model, resolution: bill.resolution },
      });
    }
    bill.settledAt = Date.now();
    w.updatedAt = Date.now();
    return bill;
  });
}

function refundReservation(userId, amountUnits, description = '任务未提交，返还冻结积分') {
  amountUnits = Math.max(0, Math.round(Number(amountUnits || 0)));
  if (!amountUnits) return wallet(userId);
  return mutate(db => {
    const w = db.wallets.find(x => x.userId === userId);
    if (!w) throw new Error('钱包不存在');
    const actual = Math.min(amountUnits, w.frozenUnits);
    w.frozenUnits -= actual;
    w.balanceUnits += actual;
    w.updatedAt = Date.now();
    recordTransaction(db, { userId, type: 'refund', amountUnits: actual, balanceAfterUnits: w.balanceUnits, description });
    return { ...w };
  });
}

function transactions(userId, limit = 100) {
  return loadDb().transactions.filter(x => x.userId === userId).slice(0, limit);
}

function listProjects(userId) {
  return loadDb().projects.filter(p => p.userId === userId).sort((a,b) => b.updatedAt - a.updatedAt).map(({ canvas, ...rest }) => rest);
}

function createProject(userId, name = '未命名项目') {
  return mutate(db => {
    const project = { id: id('prj'), userId, name: String(name || '').trim() || '未命名项目', canvas: null, createdAt: Date.now(), updatedAt: Date.now() };
    db.projects.push(project);
    const { canvas, ...rest } = project;
    return rest;
  });
}

function getProject(userId, projectId) {
  return loadDb().projects.find(p => p.id === projectId && p.userId === userId) || null;
}

function updateProject(userId, projectId, patch = {}) {
  return mutate(db => {
    const project = db.projects.find(p => p.id === projectId && p.userId === userId);
    if (!project) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
    if (typeof patch.name === 'string' && patch.name.trim()) project.name = patch.name.trim();
    if (patch.canvas && typeof patch.canvas === 'object') project.canvas = patch.canvas;
    project.updatedAt = Date.now();
    return project;
  });
}

function deleteProject(userId, projectId) {
  return mutate(db => {
    const before = db.projects.length;
    db.projects = db.projects.filter(p => !(p.id === projectId && p.userId === userId));
    return db.projects.length < before;
  });
}

function adminStats() {
  const db = loadDb();
  const totalBalanceUnits = db.wallets.reduce((s,w)=>s+w.balanceUnits,0);
  const consumedUnits = db.taskBills.filter(x=>x.status==='success').reduce((s,x)=>s+x.unitCostUnits,0);
  return {
    users: db.users.length,
    projects: db.projects.length,
    transactions: db.transactions.length,
    totalBalanceUnits,
    consumedUnits,
    pendingTasks: db.taskBills.filter(x=>x.status==='pending').length,
  };
}

module.exports = {
  loadDb, register, login, userFromToken, wallet, addBalance, reserve, addTaskBill,
  settleTaskBill, refundReservation, transactions, listProjects, createProject,
  getProject, updateProject, deleteProject, adminStats,
};
