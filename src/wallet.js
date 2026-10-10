const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const agentPricing = require('./agent-pricing');
const platformSettings = require('./platform-settings');

const LEGACY_DATA_DIR = path.join(__dirname, '..', 'data');
// 积分和账号必须落在同一个 Railway 持久化卷。优先使用专用变量，
// 兼容已经配置好的 ACCOUNT_DATA_DIR / DATA_DIR，避免重新部署后积分归零。
const configuredDataDir = process.env.WALLET_DATA_DIR || process.env.ACCOUNT_DATA_DIR || process.env.DATA_DIR;
const DATA_DIR = configuredDataDir ? path.resolve(configuredDataDir) : LEGACY_DATA_DIR;
const SHOULD_MIGRATE_LEGACY = !process.env.WALLET_DATA_DIR && DATA_DIR !== LEGACY_DATA_DIR;
const WALLET_DIR = path.join(DATA_DIR, 'wallets');
const context = new AsyncLocalStorage();
const stores = new Map();

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

// 面向用户的积分汇率固定为：10 KAI 积分 = 1 元人民币。
// 不再让 Railway 中遗留的 0.01 环境变量覆盖新汇率，否则余额迁移后会损失人民币价值。
const POINT_VALUE_RMB = 0.1;

const PRICES = {
  'Agent · GPT 5.5 Vision · 省积分': { default: agentPricing.estimate('GPT 5.5 Vision · 省积分').total },
  'Agent · GPT 5.5 Vision · 高质量': { default: agentPricing.estimate('GPT 5.5 Vision · 高质量').total },
  'Agent · Gemini 3.1 Flash Lite · 省积分': { default: agentPricing.estimate('Gemini 3.1 Flash Lite · 省积分').total },
  'Agent · Gemini 3 Flash · 标准': { default: agentPricing.estimate('Gemini 3 Flash · 标准').total },
  'Nano Banana 2': { '1K': 3, '2K': 4, '4K': 5, default: 3 },
  'Nano Banana Pro': { '1K': 3, '2K': 5, '4K': 6, default: 3 },
  'GPT Image 2': { '1K': 2, '2K': 3, '4K': 5, default: 2 },
  'GPT Image 2.5 Flare': { '1K': 3, default: 3 },
  'GPT Image 2.5 Sunburst': { '1K': 4, default: 4 },
};

function currentUserId() { return String(context.getStore()?.userId || 'local').replace(/[^a-zA-Z0-9_-]/g, '_'); }
function walletFileAt(baseDir, userId) { return userId === 'local' ? path.join(baseDir, 'wallet.json') : path.join(baseDir, 'wallets', `${userId}.json`); }
function walletFile(userId) { return walletFileAt(DATA_DIR, userId); }
function migrateLegacyWallet(userId) {
  if (!SHOULD_MIGRATE_LEGACY) return;
  const target = walletFile(userId);
  const legacy = walletFileAt(LEGACY_DATA_DIR, userId);
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(legacy, target);
}
function blankStore(userId = currentUserId()) {
  const starting = userId === 'local' ? intEnv('WALLET_STARTING_CREDITS', 100) : intEnv('ACCOUNT_SIGNUP_CREDITS', 0);
  return {
    version: 2,
    balance: starting,
    reserved: 0,
    reservations: {},
    tasks: {},
    requests: {},
    grants: {},
    ledger: starting ? [{
      id: crypto.randomUUID(), type: 'opening', amount: starting,
      note: '初始积分', createdAt: Date.now(),
    }] : [],
  };
}

function load(userId = currentUserId()) {
  fs.mkdirSync(WALLET_DIR, { recursive: true });
  migrateLegacyWallet(userId);
  const file = walletFile(userId);
  if (!fs.existsSync(file)) return blankStore(userId);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const migrated = migratePointScale({ ...blankStore(userId), ...value });
    if (migrated.changed) {
      const backup = `${file}.before-point-scale-v2.bak`;
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(migrated.store, null, 2));
      fs.renameSync(tmp, file);
    }
    return migrated.store;
  } catch {
    throw new Error('积分数据文件损坏，请先备份 data/wallet.json');
  }
}

function scaledPoints(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number((number / 10).toFixed(4)) : value;
}

function scaleQuote(quote) {
  if (!quote || typeof quote !== 'object') return quote;
  const next = { ...quote, pointValueRmb: 0.1 };
  for (const key of ['unit', 'total']) if (Number.isFinite(Number(next[key]))) next[key] = scaledPoints(next[key]);
  return next;
}

function migratePointScale(input) {
  if (Number(input?.version || 1) >= 2) return { store: input, changed: false };
  const next = { ...input, version: 2, balance: scaledPoints(input.balance), reserved: scaledPoints(input.reserved) };
  next.reservations = Object.fromEntries(Object.entries(input.reservations || {}).map(([id, item]) => [id, {
    ...item,
    unit: scaledPoints(item.unit),
    total: scaledPoints(item.total),
    pointValueRmb: 0.1,
  }]));
  next.tasks = Object.fromEntries(Object.entries(input.tasks || {}).map(([id, item]) => [id, {
    ...item,
    price: scaledPoints(item.price),
    ...(item.reservedPrice == null ? {} : { reservedPrice: scaledPoints(item.reservedPrice) }),
    quote: scaleQuote(item.quote),
  }]));
  next.ledger = (input.ledger || []).map(item => ({
    ...item,
    amount: scaledPoints(item.amount),
    meta: item.meta && typeof item.meta === 'object' ? {
      ...item.meta,
      ...(item.meta.held == null ? {} : { held: scaledPoints(item.meta.held) }),
      ...(item.meta.quote ? { quote: scaleQuote(item.meta.quote) } : {}),
    } : item.meta,
  }));
  next.grants = Object.fromEntries(Object.entries(input.grants || {}).map(([key, item]) => [key, {
    ...item,
    amount: scaledPoints(item.amount),
  }]));
  return { store: next, changed: true };
}

function activeStore() {
  const userId = currentUserId();
  if (!stores.has(userId)) stores.set(userId, load(userId));
  return stores.get(userId);
}
const store = new Proxy({}, {
  get(_target, key) { return activeStore()[key]; },
  set(_target, key, value) { activeStore()[key] = value; return true; },
  ownKeys() { return Reflect.ownKeys(activeStore()); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
});

function persist() {
  const userId = currentUserId();
  fs.mkdirSync(WALLET_DIR, { recursive: true });
  const file = walletFile(userId);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(activeStore(), null, 2));
  fs.renameSync(tmp, file);
}

function runAs(userId, fn) { return context.run({ userId: String(userId || 'local') }, fn); }
function listUserIds() {
  if (SHOULD_MIGRATE_LEGACY) {
    const legacyWalletDir = path.join(LEGACY_DATA_DIR, 'wallets');
    if (fs.existsSync(legacyWalletDir)) {
      fs.readdirSync(legacyWalletDir).filter(x => x.endsWith('.json')).forEach(name => migrateLegacyWallet(name.slice(0, -5)));
    }
  }
  if (!fs.existsSync(WALLET_DIR)) return [];
  return fs.readdirSync(WALLET_DIR).filter(x => x.endsWith('.json')).map(x => x.slice(0, -5));
}

function publicWallet() {
  return {
    balance: store.balance,
    reserved: store.reserved,
    available: Math.max(0, store.balance - store.reserved),
  };
}

function normalizeResolution(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === '4k') return '4K';
  if (normalized === '2k' || normalized === 'high' || normalized === '高质量') return '2K';
  return '1K';
}

function quote({ model, resolution, count = 1 }) {
  if (String(model || '').startsWith('Agent · ')) {
    return agentPricing.estimate(String(model).replace(/^Agent · /, ''));
  }
  const dynamic = platformSettings.priceFor(model, resolution);
  if (!dynamic) {
    const configuredModel = platformSettings.resolveModel(model);
    const normalizedRequested = normalizeResolution(resolution);
    const error = new Error(configuredModel && !configuredModel.resolutions.includes(normalizedRequested)
      ? `${model} 不支持 ${normalizedRequested}`
      : `模型未配置积分价格：${model || '未选择'}`);
    error.statusCode = 400;
    throw error;
  }
  const quantity = Number(count);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 8) {
    const error = new Error('生成数量必须是 1–8 的整数');
    error.statusCode = 400;
    throw error;
  }
  const normalizedResolution = dynamic.resolution;
  const unit = dynamic.unit;
  const total = unit * quantity;
  return {
    model, resolution: normalizedResolution, count: quantity, unit, total,
    pointValueRmb: POINT_VALUE_RMB,
    unitRmb: Number((unit * POINT_VALUE_RMB).toFixed(2)),
    totalRmb: Number((total * POINT_VALUE_RMB).toFixed(2)),
  };
}

function settleVariableTask(taskId, success, actualPrice, detail = {}) {
  const item = store.tasks[taskId];
  if (!item || item.state !== 'reserved') return publicWallet();
  const { resultText, agentModel, providerModel, ...ledgerDetail } = detail || {};
  const held = item.price;
  store.reserved = Math.max(0, store.reserved - held);
  if (success) {
    const charged = Math.max(1, Math.round(Number(actualPrice) || 1));
    // Agent 按实际 token 结算。实际费用可能高于预冻结金额；此时仍完整记账，
    // 余额可以短暂为负，后续请求会因可用积分为 0 而被阻止，避免平台替客户垫付差额。
    store.balance -= charged;
    item.reservedPrice = held;
    item.price = charged;
    item.state = 'charged';
    item.resultText = String(resultText || '').trim().slice(0, 200000);
    item.agentModel = String(agentModel || '').trim().slice(0, 120);
    item.providerModel = String(providerModel || '').trim().slice(0, 120);
    if (ledgerDetail.quote && typeof ledgerDetail.quote === 'object') item.quote = ledgerDetail.quote;
    addLedger('charge', -charged, 'Agent 按实际用量扣除', { taskId, held, ...ledgerDetail });
  } else {
    item.state = 'released';
    item.error = String(ledgerDetail.error || 'Agent 调用失败，积分已返还').slice(0, 500);
    addLedger('release', held, 'Agent 调用失败返还', { taskId, ...ledgerDetail });
  }
  item.settledAt = Date.now();
  const reservation = store.reservations[item.reservationId];
  if (reservation) reservation.state = 'settled';
  persist();
  return publicWallet();
}

function addLedger(type, amount, note, meta = {}) {
  store.ledger.unshift({ id: crypto.randomUUID(), type, amount, note, meta, createdAt: Date.now() });
  store.ledger = store.ledger.slice(0, 1000);
}

function reserve(requestId, price) {
  if (!requestId) {
    const error = new Error('缺少请求编号');
    error.statusCode = 400;
    throw error;
  }
  const priorId = store.requests[requestId];
  if (priorId) return { duplicate: true, reservation: store.reservations[priorId] };
  if (publicWallet().available < price.total) {
    const error = new Error(`积分不足：需要 ${price.total}，当前可用 ${publicWallet().available}`);
    error.statusCode = 402;
    throw error;
  }
  const id = crypto.randomUUID();
  const reservation = { id, requestId, ...price, attached: 0, state: 'reserved', createdAt: Date.now() };
  store.reservations[id] = reservation;
  store.requests[requestId] = id;
  store.reserved += price.total;
  addLedger('reserve', -price.total, `冻结：${price.model} × ${price.count}`, { reservationId: id });
  persist();
  return { duplicate: false, reservation };
}

function attachTasks(reservationId, taskItems) {
  const reservation = store.reservations[reservationId];
  if (!reservation || reservation.state !== 'reserved') throw new Error('积分预留记录不存在');
  const items = (taskItems || []).map(item => typeof item === 'string' ? { taskId: item } : item).filter(item => item?.taskId);
  const ids = [...new Set(items.map(item => item.taskId))];
  ids.forEach(taskId => {
    const meta = items.find(item => item.taskId === taskId) || {};
    store.tasks[taskId] ||= { taskId, reservationId, requestId: reservation.requestId || '', price: reservation.unit, state: 'reserved', createdAt: Date.now() };
    store.tasks[taskId].requestId ||= reservation.requestId || '';
    store.tasks[taskId].taskApi = meta.taskApi || store.tasks[taskId].taskApi || 'market';
    store.tasks[taskId].model = meta.model || reservation.model;
  });
  reservation.attached = ids.length;
  const unused = (reservation.count - ids.length) * reservation.unit;
  if (unused > 0) {
    store.reserved -= unused;
    addLedger('release', unused, '未提交任务返还', { reservationId });
  }
  reservation.total = ids.length * reservation.unit;
  reservation.count = ids.length;
  if (!ids.length) reservation.state = 'released';
  persist();
  return reservation;
}

function releaseUnattached(reservationId, note = '任务创建失败返还') {
  const reservation = store.reservations[reservationId];
  if (!reservation || reservation.state !== 'reserved' || reservation.attached) return;
  store.reserved -= reservation.total;
  reservation.state = 'released';
  addLedger('release', reservation.total, note, { reservationId });
  persist();
}

function settleTask(taskId, success, detail = {}) {
  const item = store.tasks[taskId];
  if (!item) return publicWallet();
  let metadataChanged = false;
  if (success && Array.isArray(detail.resultUrls) && detail.resultUrls.length) {
    item.resultUrls = detail.resultUrls.map(String).filter(Boolean).slice(0, 8);
    metadataChanged = true;
  }
  if (success && detail.providerModel) {
    item.providerModel = String(detail.providerModel).slice(0, 160);
    metadataChanged = true;
  }
  if (item.state !== 'reserved') {
    if (metadataChanged) persist();
    return publicWallet();
  }
  store.reserved = Math.max(0, store.reserved - item.price);
  if (success) {
    store.balance = Math.max(0, store.balance - item.price);
    item.state = 'charged';
    addLedger('charge', -item.price, '生成成功扣除', { taskId, ...detail });
  } else {
    item.state = 'released';
    addLedger('release', item.price, '生成失败返还', { taskId, ...detail });
  }
  item.settledAt = Date.now();
  const reservation = store.reservations[item.reservationId];
  if (reservation) {
    const children = Object.values(store.tasks).filter(x => x.reservationId === reservation.id);
    if (children.length && children.every(x => x.state !== 'reserved')) reservation.state = 'settled';
  }
  persist();
  return publicWallet();
}

function releaseExpiredTasks(maxAgeMs, now = Date.now()) {
  const timeout = Number(maxAgeMs);
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error('任务超时时间无效');
  const cutoff = Number(now) - timeout;
  let releasedTasks = 0;
  let releasedReservations = 0;
  let releasedPoints = 0;
  let changed = false;

  Object.values(store.tasks).forEach(item => {
    if (item.state !== 'reserved' || Number(item.createdAt || 0) > cutoff) return;
    const points = Math.max(0, Number(item.price) || 0);
    store.reserved = Math.max(0, store.reserved - points);
    item.state = 'released';
    item.settledAt = Number(now);
    item.failCode = 'TASK_TIMEOUT';
    item.error = '任务等待超时，积分已自动返还';
    addLedger('release', points, '任务超时自动返还', { taskId: item.taskId, reservationId: item.reservationId });
    releasedTasks += 1;
    releasedPoints += points;
    changed = true;
  });

  Object.values(store.reservations).forEach(reservation => {
    if (reservation.state !== 'reserved') return;
    const children = Object.values(store.tasks).filter(item => item.reservationId === reservation.id);
    if (children.length && children.every(item => item.state !== 'reserved')) {
      reservation.state = 'settled';
      reservation.settledAt = Number(now);
      changed = true;
      return;
    }
    if (children.length || Number(reservation.createdAt || 0) > cutoff) return;
    const points = Math.max(0, Number(reservation.total) || 0);
    store.reserved = Math.max(0, store.reserved - points);
    reservation.state = 'released';
    reservation.settledAt = Number(now);
    addLedger('release', points, '未创建任务超时自动返还', { reservationId: reservation.id });
    releasedReservations += 1;
    releasedPoints += points;
    changed = true;
  });

  if (changed) persist();
  return { releasedTasks, releasedReservations, releasedPoints, wallet: publicWallet() };
}

function recentLedger(limit = 30) {
  return store.ledger.slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
}

function grant(amount, note = '管理员增加积分', idempotencyKey = '') {
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 1 || value > 1000000) throw new Error('积分必须是 1–1000000 的整数');
  const key = String(idempotencyKey || '').trim().slice(0, 160);
  if (key && store.grants?.[key]) return publicWallet();
  store.balance += value;
  addLedger('grant', value, note, key ? { idempotencyKey: key } : {});
  if (key) {
    if (!store.grants || typeof store.grants !== 'object') store.grants = {};
    store.grants[key] = { amount: value, createdAt: Date.now() };
  }
  persist();
  return publicWallet();
}

function pendingTasks() {
  return Object.values(store.tasks).filter(item => item.state === 'reserved');
}

function recentTasks(limit = 20) {
  return Object.values(store.tasks)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)))
    .map(item => ({ ...item }));
}

function hasTask(taskId) {
  return Boolean(store.tasks[String(taskId || '')]);
}

function normalizedGeneratedPath(value) {
  try {
    const pathname = /^https?:\/\//i.test(String(value || '')) ? new URL(String(value)).pathname : String(value || '').split(/[?#]/)[0];
    if (!pathname.startsWith('/generated/')) return '';
    const fileName = decodeURIComponent(pathname.slice('/generated/'.length));
    return fileName && path.basename(fileName) === fileName ? `/generated/${fileName}` : '';
  } catch { return ''; }
}

function ownsResultUrl(url) {
  const wanted = normalizedGeneratedPath(url);
  if (!wanted) return false;
  return Object.values(store.tasks).some(task =>
    Array.isArray(task.resultUrls) && task.resultUrls.some(item => normalizedGeneratedPath(item) === wanted)
  );
}

function taskByRequest(requestId) {
  const reservationId = store.requests[String(requestId || '')];
  if (!reservationId) return null;
  const item = Object.values(store.tasks).find(task => task.reservationId === reservationId);
  return item ? { ...item } : null;
}

function tasksByRequest(requestId) {
  const reservationId = store.requests[String(requestId || '')];
  if (!reservationId) return [];
  return Object.values(store.tasks)
    .filter(task => task.reservationId === reservationId)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .map(item => ({ ...item }));
}

function recentAgentResults(limit = 20) {
  return Object.values(store.tasks)
    .filter(item => item.taskApi === 'agent' && item.state === 'charged' && String(item.resultText || '').trim())
    .sort((a, b) => Number(b.settledAt || b.createdAt || 0) - Number(a.settledAt || a.createdAt || 0))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)))
    .map(item => ({
      taskId: item.taskId,
      requestId: item.requestId || '',
      state: item.state,
      text: item.resultText,
      model: item.agentModel || String(item.model || '').replace(/^Agent\s*·\s*/, ''),
      providerModel: item.providerModel || '',
      quote: item.quote || null,
      createdAt: item.createdAt || 0,
      settledAt: item.settledAt || 0,
    }));
}

function pricing() {
  const imagePrices = Object.fromEntries(platformSettings.publicModels().map(model => [model.name, { ...model.prices, default: model.prices[model.resolutions[0]] }]));
  return { ...PRICES, ...imagePrices };
}
function pointValueRmb() { return POINT_VALUE_RMB; }

module.exports = {
  publicWallet, quote, reserve, attachTasks, releaseUnattached,
  settleTask, settleVariableTask, recentLedger, pendingTasks, recentTasks, hasTask, ownsResultUrl, pricing, pointValueRmb, grant,
  tasksByRequest,
  taskByRequest, recentAgentResults, releaseExpiredTasks, runAs, listUserIds,
};
