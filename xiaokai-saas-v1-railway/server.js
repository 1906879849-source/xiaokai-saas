require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { resolveModel, listModels } = require('./src/model-router');
const { pricePoints, priceUnits, PRICE_POINTS, POINTS_PER_YUAN, UNITS_PER_POINT, normalizeResolution } = require('./src/pricing');
const store = require('./src/store');
const kie = require('./src/providers/kie');

const app = express();
const PORT = Number(process.env.PORT || 4318);
const PUBLIC_DIR = path.join(__dirname, 'public');
const GENERATED_DIR = process.env.GENERATED_DIR || path.join(__dirname, 'generated');
fs.mkdirSync(GENERATED_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const cachedTaskUrls = new Map();

function safeJsonError(res, error) {
  const status = Number(error?.statusCode || 500);
  res.status(status).json({
    ok: false,
    error: error?.message || '服务器错误',
    details: process.env.NODE_ENV === 'development' ? error?.payload : undefined,
  });
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function authUser(req) {
  return store.userFromToken(bearer(req));
}

function requireAuth(req, res, next) {
  const user = authUser(req);
  if (!user) return res.status(401).json({ ok: false, error: '请先登录' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = authUser(req);
  if (!user) return res.status(401).json({ ok: false, error: '请先登录' });
  if (user.role !== 'admin') return res.status(403).json({ ok: false, error: '没有管理员权限' });
  req.user = user;
  next();
}

function walletPayload(userId) {
  const w = store.wallet(userId);
  return {
    balanceUnits: w.balanceUnits,
    frozenUnits: w.frozenUnits,
    balancePoints: w.balanceUnits / UNITS_PER_POINT,
    frozenPoints: w.frozenUnits / UNITS_PER_POINT,
    pointsPerYuan: POINTS_PER_YUAN,
  };
}

function extFromContentType(type = '') {
  if (/png/i.test(type)) return '.png';
  if (/webp/i.test(type)) return '.webp';
  if (/gif/i.test(type)) return '.gif';
  if (/jpeg|jpg/i.test(type)) return '.jpg';
  return '.png';
}

async function cacheRemoteResults(taskId, urls) {
  if (cachedTaskUrls.has(taskId)) return cachedTaskUrls.get(taskId);
  const local = [];
  let index = 0;
  for (const url of urls) {
    index += 1;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`下载生成图失败：HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = extFromContentType(response.headers.get('content-type') || '');
      const digest = crypto.createHash('sha1').update(`${taskId}-${index}-${url}`).digest('hex').slice(0, 10);
      const fileName = `${String(taskId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70)}-${index}-${digest}${ext}`;
      fs.writeFileSync(path.join(GENERATED_DIR, fileName), buffer);
      local.push(`/generated/${fileName}`);
    } catch {
      local.push(url);
    }
  }
  cachedTaskUrls.set(taskId, local);
  return local;
}

// ---------- public / auth ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'xiaokai-saas-v1',
    kieConfigured: Boolean((process.env.KIE_API_KEY || '').trim()),
    models: listModels(),
  });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const user = store.register(req.body || {});
    const result = store.login({ email: req.body.email, password: req.body.password });
    res.json({ ok: true, ...result, wallet: walletPayload(user.id) });
  } catch (error) { safeJsonError(res, error); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const result = store.login(req.body || {});
    res.json({ ok: true, ...result, wallet: walletPayload(result.user.id) });
  } catch (error) { safeJsonError(res, error); }
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user, wallet: walletPayload(req.user.id) });
});

app.get('/api/pricing', (req, res) => {
  res.json({ ok: true, unitsPerPoint: UNITS_PER_POINT, pointsPerYuan: POINTS_PER_YUAN, prices: PRICE_POINTS });
});

// ---------- wallet ----------
app.get('/api/wallet', requireAuth, (req, res) => {
  res.json({ ok: true, wallet: walletPayload(req.user.id) });
});

app.get('/api/transactions', requireAuth, (req, res) => {
  const rows = store.transactions(req.user.id, 200).map(x => ({
    ...x,
    amountPoints: x.amountUnits / UNITS_PER_POINT,
    balanceAfterPoints: x.balanceAfterUnits / UNITS_PER_POINT,
  }));
  res.json({ ok: true, transactions: rows });
});

app.post('/api/wallet/dev-topup', requireAuth, (req, res) => {
  const enabled = process.env.ENABLE_DEV_TOPUP === 'true';
  if (!enabled) return res.status(403).json({ ok: false, error: '测试充值已关闭' });
  if (process.env.NODE_ENV === 'production' && req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '线上测试充值仅管理员可用' });
  try {
    const yuan = Math.max(1, Math.min(5000, Number(req.body?.yuan || 0)));
    const points = Math.round(yuan * POINTS_PER_YUAN);
    store.addBalance(req.user.id, points * UNITS_PER_POINT, 'topup', `测试充值 ¥${yuan} = ${points} 积分`);
    res.json({ ok: true, wallet: walletPayload(req.user.id), yuan, points, testMode: true });
  } catch (error) { safeJsonError(res, error); }
});

// ---------- projects / cloud canvas ----------
app.get('/api/projects', requireAuth, (req, res) => {
  res.json({ ok: true, projects: store.listProjects(req.user.id) });
});

app.post('/api/projects', requireAuth, (req, res) => {
  try { res.json({ ok: true, project: store.createProject(req.user.id, req.body?.name) }); }
  catch (error) { safeJsonError(res, error); }
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = store.getProject(req.user.id, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: '项目不存在' });
  res.json({ ok: true, project });
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  try { res.json({ ok: true, project: store.updateProject(req.user.id, req.params.id, req.body || {}) }); }
  catch (error) { safeJsonError(res, error); }
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  res.json({ ok: store.deleteProject(req.user.id, req.params.id) });
});

// ---------- Kie ----------
app.get('/api/credits', async (req, res) => {
  try {
    const credits = await kie.getCredits();
    res.json({ ok: true, provider: 'kie', credits });
  } catch (error) { safeJsonError(res, error); }
});

app.post('/api/image/generate', requireAuth, async (req, res) => {
  let reservedUnits = 0;
  let createdCount = 0;
  try {
    const body = req.body || {};
    const modelName = String(body.model || '').trim();
    const model = resolveModel(modelName);
    if (!model) return res.status(400).json({ ok: false, error: `暂未接入模型：${modelName || '未选择'}`, supportedModels: listModels().map(x => x.name) });
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ ok: false, error: 'Prompt 不能为空' });

    const count = Math.max(1, Math.min(8, Number(body.count || 1) || 1));
    const resolution = normalizeResolution(body.resolution);
    const unitCost = priceUnits(modelName, resolution);
    if (unitCost == null) return res.status(400).json({ ok: false, error: '当前模型还没有配置积分价格' });
    reservedUnits = unitCost * count;
    store.reserve(req.user.id, reservedUnits, { description: `${modelName} ${resolution} × ${count} 冻结积分`, model: modelName, resolution, count });

    const rawImages = Array.isArray(body.images) ? body.images.slice(0, 14) : [];
    const imageUrls = await kie.prepareImageUrls(rawImages);
    const callbackUrl = (process.env.PUBLIC_BASE_URL || '').trim() ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/callback/kie` : '';

    const tasks = [];
    const warnings = new Set();
    let creationError = null;
    for (let i = 0; i < count; i += 1) {
      try {
        const created = await kie.createImageTask({
          modelName,
          prompt,
          aspectRatio: body.aspectRatio,
          resolution,
          background: body.background,
          imageUrls,
          callbackUrl,
        });
        createdCount += 1;
        created.warnings.forEach(w => warnings.add(w));
        store.addTaskBill({ taskId: created.taskId, userId: req.user.id, unitCostUnits: unitCost, model: modelName, resolution });
        tasks.push({ taskId: created.taskId, providerModel: created.model });
      } catch (error) {
        creationError = error;
        break;
      }
    }

    if (createdCount < count) {
      const refund = unitCost * (count - createdCount);
      store.refundReservation(req.user.id, refund, `未成功提交的 ${count - createdCount} 个任务返还积分`);
      if (creationError) warnings.add(`部分任务未提交：${creationError.message}`);
    }

    if (!tasks.length) throw creationError || new Error('Kie 没有返回任务 ID');

    res.json({
      ok: true,
      provider: 'kie',
      model: modelName,
      tasks,
      warnings: [...warnings],
      billing: {
        unitPricePoints: pricePoints(modelName, resolution),
        reservedPoints: (unitCost * createdCount) / UNITS_PER_POINT,
        wallet: walletPayload(req.user.id),
      },
    });
  } catch (error) {
    if (reservedUnits && createdCount === 0) {
      try { store.refundReservation(req.user.id, reservedUnits, '任务提交失败，返还冻结积分'); } catch {}
    }
    safeJsonError(res, error);
  }
});

app.get('/api/task/:taskId', requireAuth, async (req, res) => {
  try {
    const task = await kie.getTask(req.params.taskId);
    let urls = task.resultUrls;
    if (task.state === 'success') store.settleTaskBill(task.taskId, 'success');
    if (task.state === 'fail') store.settleTaskBill(task.taskId, 'fail', task.failMsg || task.failCode || '');
    if (task.state === 'success' && urls.length) urls = await cacheRemoteResults(task.taskId, urls);
    const base = `${req.protocol}://${req.get('host')}`;
    const absoluteUrls = urls.map(url => url.startsWith('/') ? `${base}${url}` : url);
    res.json({
      ok: true,
      provider: 'kie',
      taskId: task.taskId,
      model: task.model,
      state: task.state,
      progress: task.progress,
      urls: absoluteUrls,
      failCode: task.failCode,
      failMsg: task.failMsg,
      costTime: task.costTime,
      creditsConsumed: task.creditsConsumed,
      wallet: walletPayload(req.user.id),
    });
  } catch (error) { safeJsonError(res, error); }
});

app.post('/api/callback/kie', (req, res) => {
  console.log('[Kie callback]', JSON.stringify(req.body).slice(0, 1200));
  res.json({ ok: true });
});

// ---------- admin ----------
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({ ok: true, stats: store.adminStats() });
});

app.use('/generated', express.static(GENERATED_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

const portalRoutes = ['/', '/login', '/dashboard', '/billing', '/transactions', '/settings', '/admin'];
portalRoutes.forEach(route => app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'portal.html'))));
app.get(['/workspace', '/workspace/:id'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'workspace.html')));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'portal.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nxiaokai SaaS V1 已启动：0.0.0.0:${PORT}`);
  console.log(`Kie Key：${process.env.KIE_API_KEY ? '已配置' : '未配置（请编辑 .env）'}`);
  console.log('首页：http://127.0.0.1:4318/');
  console.log('工作台：http://127.0.0.1:4318/dashboard\n');
});
