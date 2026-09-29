const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const agentPricing = require('./agent-pricing');

const DATA_DIR = process.env.WALLET_DATA_DIR
  ? path.resolve(process.env.WALLET_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const WALLET_DIR = path.join(DATA_DIR, 'wallets');
const context = new AsyncLocalStorage();
const stores = new Map();

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// 面向用户的积分汇率：100 KAI 积分 = 1 元人民币。
const POINT_VALUE_RMB = numberEnv('KAI_POINT_VALUE_RMB', 0.01);

const PRICES = {
  'Agent · GPT 5.5 Compact · Instant': { default: agentPricing.estimate('GPT 5.5 Compact · Instant').total },
  'Agent · GPT 5.5 · Thinking': { default: agentPricing.estimate('GPT 5.5 · Thinking').total },
  'Agent · GPT 5.6 SOL · Pro': { default: agentPricing.estimate('GPT 5.6 SOL · Pro').total },
  'Agent · Gemini 3.1 Flash Lite': { default: agentPricing.estimate('Gemini 3.1 Flash Lite').total },
  'Agent · Gemini 3 Flash Thinking': { default: agentPricing.estimate('Gemini 3 Flash Thinking').total },
  'Agent · Gemini 3.1 Pro High': { default: agentPricing.estimate('Gemini 3.1 Pro High').total },
  'GPT Image 2': {
    '1K': intEnv('PRICE_GPT_IMAGE_2_1K', 24),
    '2K': intEnv('PRICE_GPT_IMAGE_2_2K', 24),
    '4K': intEnv('PRICE_GPT_IMAGE_2_4K', 24),
    default: intEnv('PRICE_GPT_IMAGE_2_2K', 24),
  },
  'GPT Image 2 · 4K 超分': { default: intEnv('PRICE_GPT_IMAGE_2_4K_UPSCALE', 24) },
  'GPT Image 2 · 原生 4K': { default: intEnv('PRICE_GPT_IMAGE_2_NATIVE_4K', 40) },
  'GPT Image 2.5 Flare': {
    '1K': intEnv('PRICE_GPT_IMAGE_2_5_FLARE_1K', 24),
    '2K': intEnv('PRICE_GPT_IMAGE_2_5_FLARE_2K', 24),
    '4K': intEnv('PRICE_GPT_IMAGE_2_5_FLARE_4K', 24),
    default: intEnv('PRICE_GPT_IMAGE_2_5_FLARE_2K', 24),
  },
  'GPT Image 2.5 Sunburst': {
    '1K': intEnv('PRICE_GPT_IMAGE_2_5_SUNBURST_1K', 24),
    '2K': intEnv('PRICE_GPT_IMAGE_2_5_SUNBURST_2K', 24),
    '4K': intEnv('PRICE_GPT_IMAGE_2_5_SUNBURST_4K', 24),
    default: intEnv('PRICE_GPT_IMAGE_2_5_SUNBURST_2K', 24),
  },
  'Gemini 3 Pro Image': { default: intEnv('PRICE_GEMINI_3_PRO_IMAGE', 80) },
  'Gemini 3.1 Flash Image': { default: intEnv('PRICE_GEMINI_3_1_FLASH_IMAGE', 60) },
};

function currentUserId() { return String(context.getStore()?.userId || 'local').replace(/[^a-zA-Z0-9_-]/g, '_'); }
function walletFile(userId) { return userId === 'local' ? path.join(DATA_DIR, 'wallet.json') : path.join(WALLET_DIR, `${userId}.json`); }
function blankStore(userId = currentUserId()) {
  const starting = userId === 'local' ? intEnv('WALLET_STARTING_CREDITS', 1000) : intEnv('ACCOUNT_SIGNUP_CREDITS', 0);
  return {
    version: 1,
    balance: starting,
    reserved: 0,
    reservations: {},
    tasks: {},
    requests: {},
    ledger: starting ? [{
      id: crypto.randomUUID(), type: 'opening', amount: starting,
      note: '测试初始积分', createdAt: Date.now(),
    }] : [],
  };
}

function load(userId = currentUserId()) {
  fs.mkdirSync(WALLET_DIR, { recursive: true });
  const file = walletFile(userId);
  if (!fs.existsSync(file)) return blankStore(userId);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...blankStore(userId), ...value };
  } catch {
    throw new Error('积分数据文件损坏，请先备份 data/wallet.json');
  }
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
  const normalized = String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  return ['1K', '2K', '4K'].includes(normalized) ? normalized : '2K';
}

function quote({ model, resolution, count = 1 }) {
  if (String(model || '').startsWith('Agent · ')) {
    return agentPricing.estimate(String(model).replace(/^Agent · /, ''));
  }
  const pricing = PRICES[model];
  if (!pricing) {
    const error = new Error(`模型未配置积分价格：${model || '未选择'}`);
    error.statusCode = 400;
    throw error;
  }
  const quantity = Number(count);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 8) {
    const error = new Error('生成数量必须是 1–8 的整数');
    error.statusCode = 400;
    throw error;
  }
  const normalizedResolution = normalizeResolution(resolution);
  const unit = pricing[normalizedResolution] ?? pricing.default;
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
  const held = item.price;
  store.reserved = Math.max(0, store.reserved - held);
  if (success) {
    const charged = Math.max(1, Math.round(Number(actualPrice) || 1));
    store.balance = Math.max(0, store.balance - charged);
    item.reservedPrice = held;
    item.price = charged;
    item.state = 'charged';
    addLedger('charge', -charged, 'Agent 按实际用量扣除', { taskId, held, ...detail });
  } else {
    item.state = 'released';
    addLedger('release', held, 'Agent 调用失败返还', { taskId, ...detail });
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
    store.tasks[taskId] ||= { taskId, reservationId, price: reservation.unit, state: 'reserved', createdAt: Date.now() };
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
  if (!item || item.state !== 'reserved') return publicWallet();
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

function recentLedger(limit = 30) {
  return store.ledger.slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
}

function grant(amount, note = '手动增加测试积分') {
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 1 || value > 1000000) throw new Error('积分必须是 1–1000000 的整数');
  store.balance += value;
  addLedger('grant', value, note);
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

function pricing() { return PRICES; }
function pointValueRmb() { return POINT_VALUE_RMB; }

module.exports = {
  publicWallet, quote, reserve, attachTasks, releaseUnattached,
  settleTask, settleVariableTask, recentLedger, pendingTasks, recentTasks, pricing, pointValueRmb, grant,
  runAs, listUserIds,
};
