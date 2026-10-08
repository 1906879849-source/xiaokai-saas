require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { resolveModel, listModels } = require('./src/model-router');
const kie = require('./src/providers/kie');
const mockImage = require('./src/providers/mock-image');
const otterlImage = require('./src/providers/otterl-image');
const otterlChat = require('./src/providers/otterl-chat');
const wallet = require('./src/wallet');
const agentPricing = require('./src/agent-pricing');
const accounts = require('./src/accounts');
const workflows = require('./src/workflows');
const announcements = require('./src/announcements');
const platformSettings = require('./src/platform-settings');
const { generatedDir } = require('./src/storage-paths');

const app = express();
const PORT = Number(process.env.PORT || 4318);
const STARTED_AT = Date.now();
const PUBLIC_DIR = path.join(__dirname, 'public');
const GENERATED_DIR = generatedDir();
fs.mkdirSync(GENERATED_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// 方便你暂时仍用 4180 打开旧页面；正式上线建议只允许自己的域名。
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    if (origin && origin !== 'null') res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const cachedTaskUrls = new Map();

function preferredImageProvider() {
  const value = String(process.env.IMAGE_PROVIDER || 'auto').trim().toLowerCase();
  return ['auto', 'kie', 'otterl'].includes(value) ? value : 'auto';
}

function selectImageProvider(modelName, modelMeta) {
  if (modelMeta.provider === 'mock') return { name: 'mock', client: mockImage, warning: '' };
  if (modelMeta.provider === 'otterl') {
    if (!otterlImage.supportsModel(modelName)) {
      const error = new Error(`${modelName} 尚未配置 OtterL 模型映射。`);
      error.statusCode = 400;
      throw error;
    }
    if (!otterlImage.configured()) {
      const error = new Error('OTTERL_API_KEY 未配置。请先在本机 .env 中填写。');
      error.statusCode = 503;
      throw error;
    }
    return { name: 'otterl', client: otterlImage, warning: '' };
  }
  const preferred = preferredImageProvider();
  const supportedByOtterl = otterlImage.supportsModel(modelName);
  if (preferred === 'otterl' && !supportedByOtterl) {
    return { name: 'kie', client: kie, warning: `${modelName} 暂未映射到 OtterL，本次自动使用 KIE。` };
  }
  if (supportedByOtterl && (preferred === 'otterl' || (preferred === 'auto' && otterlImage.configured()))) {
    return { name: 'otterl', client: otterlImage, warning: '' };
  }
  return { name: 'kie', client: kie, warning: '' };
}

function providerFromTaskApi(taskApi) {
  if (taskApi === 'mock') return { name: 'mock', client: mockImage };
  if (taskApi === 'otterl') return { name: 'otterl', client: otterlImage };
  return { name: 'kie', client: kie };
}

function safeJsonError(res, error) {
  const status = Number(error?.statusCode || 500);
  res.status(status).json({
    ok: false,
    error: error?.message || '服务器错误',
    details: process.env.NODE_ENV === 'development' ? error?.payload : undefined,
  });
}

function extFromContentType(type = '') {
  if (/svg/i.test(type)) return '.svg';
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
    if (String(url).startsWith('/generated/')) {
      local.push(url);
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`下载生成图失败：HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = extFromContentType(response.headers.get('content-type') || '');
      const digest = crypto.createHash('sha1').update(`${taskId}-${index}-${url}`).digest('hex').slice(0, 10);
      const fileName = `${String(taskId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70)}-${index}-${digest}${ext}`;
      fs.writeFileSync(path.join(GENERATED_DIR, fileName), buffer);
      local.push(`/generated/${fileName}`);
    } catch (error) {
      // 如果缓存失败，仍返回 Kie 原始 URL，避免丢掉已经生成成功的结果。
      local.push(url);
    } finally {
      clearTimeout(timeout);
    }
  }
  cachedTaskUrls.set(taskId, local);
  return local;
}

app.get('/api/health', (req, res) => {
  const settings = platformSettings.read();
  res.json({
    ok: true,
    service: 'xiaokai-kie-v1',
    version: String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_VERSION || 'local').slice(0, 12),
    startedAt: STARTED_AT,
    uptimeSeconds: Math.floor(process.uptime()),
    maintenance: settings.maintenance,
    kieConfigured: Boolean((process.env.KIE_API_KEY || '').trim()),
    otterlConfigured: otterlImage.configured(),
    imageProvider: preferredImageProvider(),
    models: listModels(),
    agentModels: otterlChat.listModels(),
  });
});

app.get('/api/platform/status', (req, res) => {
  const settings = platformSettings.read();
  res.json({
    ok: true,
    service: 'xiaokai-kie-v1',
    status: settings.maintenance.enabled ? 'maintenance' : 'operational',
    maintenance: settings.maintenance,
    version: String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_VERSION || 'local').slice(0, 12),
    startedAt: STARTED_AT,
    serverTime: Date.now(),
  });
});

app.get('/api/models', (req, res) => {
  res.json({ ok: true, models: platformSettings.publicModels(), pointValueRmb: wallet.pointValueRmb() });
});

function cookieToken(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)kai_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}
function requestToken(req) {
  const auth = String(req.get('Authorization') || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : cookieToken(req);
}
function setSessionCookie(res, token) {
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `kai_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'kai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

app.post('/api/auth/register', (req, res) => {
  try {
    const user = accounts.register(req.body || {});
    const token = accounts.createSession(user.id);
    setSessionCookie(res, token);
    wallet.runAs(user.id, () => {
      const initialAdminCredits = user.role === 'admin' ? Number(process.env.FIRST_ADMIN_CREDITS || 0) : 0;
      if (Number.isInteger(initialAdminCredits) && initialAdminCredits > 0 && wallet.publicWallet().balance === 0) wallet.grant(initialAdminCredits, '管理员初始积分');
      res.json({ ok: true, user, wallet: wallet.publicWallet() });
    });
  } catch (error) { safeJsonError(res, error); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const user = accounts.authenticate(req.body?.username, req.body?.password);
    const token = accounts.createSession(user.id);
    setSessionCookie(res, token);
    wallet.runAs(user.id, () => res.json({ ok: true, user, wallet: wallet.publicWallet() }));
  } catch (error) { safeJsonError(res, error); }
});

app.post('/api/auth/logout', (req, res) => {
  accounts.revokeSession(requestToken(req)); clearSessionCookie(res); res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = accounts.sessionUser(requestToken(req));
  if (!user) return res.status(401).json({ ok: false, error: '请先登录' });
  wallet.runAs(user.id, () => res.json({ ok: true, user, wallet: wallet.publicWallet() }));
});

const PUBLIC_API = new Set(['/health', '/platform/status', '/models', '/auth/register', '/auth/login', '/auth/logout', '/auth/me', '/callback/kie']);
app.use('/api', (req, res, next) => {
  if (PUBLIC_API.has(req.path)) return next();
  const user = accounts.sessionUser(requestToken(req));
  if (!user) return res.status(401).json({ ok: false, error: '请先登录后再使用画布' });
  req.user = user;
  wallet.runAs(user.id, next);
});

app.use('/api', (req, res, next) => {
  const maintenance = platformSettings.read().maintenance;
  const startingPaidTask = req.method === 'POST' && ['/agent/run', '/image/generate'].includes(req.path);
  if (maintenance.enabled && startingPaidTask && req.user?.role !== 'admin') {
    return res.status(503).json({ ok: false, code: 'MAINTENANCE', error: maintenance.message, maintenance });
  }
  next();
});

app.post('/api/recharges', (req, res) => {
  try {
    const recharge = accounts.createRecharge({ userId: req.user.id, ...(req.body || {}) });
    res.json({ ok: true, recharge, wallet: wallet.publicWallet() });
  } catch (error) { safeJsonError(res, error); }
});

app.get('/api/recharges', (req, res) => {
  res.json({ ok: true, recharges: accounts.listRecharges(req.user.id, req.query.limit), wallet: wallet.publicWallet() });
});

app.get('/api/announcements', (req, res) => {
  res.json({ ok: true, announcements: announcements.list({ activeOnly: true }) });
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: '需要管理员权限' });
  next();
}

app.get('/api/workflows', (req, res) => {
  res.json({ ok: true, workflows: workflows.list(), canManage: req.user?.role === 'admin' });
});
app.get('/api/workflows/:id', (req, res) => {
  const item = workflows.get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: '工作流不存在或已下架' });
  res.json({ ok: true, workflow: item.workflow, meta: { id: item.id, name: item.name, description: item.description || '' } });
});
app.post('/api/admin/workflows', requireAdmin, (req, res) => {
  try {
    const preset = workflows.save({ ...(req.body || {}), authorId: req.user.id });
    res.json({ ok: true, preset });
  } catch (error) { safeJsonError(res, error); }
});
app.delete('/api/admin/workflows/:id', requireAdmin, (req, res) => {
  if (!workflows.remove(req.params.id)) return res.status(404).json({ ok: false, error: '工作流不存在' });
  res.json({ ok: true });
});

app.get('/api/admin/recharges', requireAdmin, (req, res) => {
  res.json({ ok: true, recharges: accounts.listRecharges('', req.query.limit || 100) });
});
app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ ok: true, users: accounts.listUsers() });
});
app.post('/api/admin/users/:id/grant', requireAdmin, (req, res) => {
  try {
    const amount = Number(req.body?.points);
    const target = accounts.listUsers().find(user => user.id === req.params.id);
    if (!target) return res.status(404).json({ ok: false, error: '用户不存在' });
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) return res.status(400).json({ ok: false, error: '积分必须是 1–1000000 的整数' });
    const targetWallet = wallet.runAs(target.id, () => wallet.grant(amount, `管理员充值：${req.user.username}`));
    res.json({ ok: true, user: target, wallet: targetWallet });
  } catch (error) { safeJsonError(res, error); }
});
app.get('/api/admin/recharges/:id/receipt', requireAdmin, (req, res) => {
  const file = accounts.receiptPath(req.params.id);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ ok: false, error: '付款截图不存在' });
  res.sendFile(file);
});
app.post('/api/admin/recharges/:id/review', requireAdmin, (req, res) => {
  try {
    const before = accounts.getRecharge(req.params.id);
    if (!before) return res.status(404).json({ ok: false, error: '充值申请不存在' });
    if (before.status !== 'pending') return res.status(409).json({ ok: false, error: '这笔充值已经审核过，不能重复到账' });
    if (req.body?.status === 'approved') wallet.runAs(before.userId, () => wallet.grant(before.points, `充值到账：${before.id}`, `recharge:${before.id}`));
    const recharge = accounts.reviewRecharge(req.params.id, { reviewerId: req.user.id, status: req.body?.status, reviewNote: req.body?.reviewNote });
    res.json({ ok: true, recharge });
  } catch (error) { safeJsonError(res, error); }
});

app.get('/api/admin/announcements', requireAdmin, (req, res) => {
  res.json({ ok: true, announcements: announcements.list() });
});
app.post('/api/admin/announcements', requireAdmin, (req, res) => {
  try { res.json({ ok: true, announcement: announcements.create(req.body || {}, req.user.id) }); }
  catch (error) { safeJsonError(res, error); }
});
app.delete('/api/admin/announcements/:id', requireAdmin, (req, res) => {
  if (!announcements.remove(req.params.id)) return res.status(404).json({ ok: false, error: '公告不存在' });
  res.json({ ok: true });
});

app.get('/api/admin/platform', requireAdmin, (req, res) => {
  res.json({ ok: true, settings: platformSettings.read(), health: { startedAt: STARTED_AT, uptimeSeconds: Math.floor(process.uptime()), version: String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_VERSION || 'local').slice(0, 12), kieConfigured: Boolean((process.env.KIE_API_KEY || '').trim()), otterlConfigured: otterlImage.configured() } });
});
app.put('/api/admin/platform/maintenance', requireAdmin, (req, res) => {
  try { res.json({ ok: true, settings: platformSettings.updateMaintenance(req.body || {}, req.user.username) }); }
  catch (error) { safeJsonError(res, error); }
});
app.put('/api/admin/platform/models', requireAdmin, (req, res) => {
  try { res.json({ ok: true, settings: platformSettings.updateModels(req.body?.models, req.user.username) }); }
  catch (error) { safeJsonError(res, error); }
});

app.post('/api/agent/run', async (req, res) => {
  let reservationId = '';
  let billingTaskId = '';
  try {
    const body = req.body || {};
    const model = String(body.model || '').trim();
    if (!otterlChat.listModels().includes(model)) {
      return res.status(400).json({ ok: false, error: `Agent 模型暂未接入：${model || '未选择'}`, supportedModels: otterlChat.listModels() });
    }
    const rawImages = Array.isArray(body.images) ? body.images.slice(0, 10) : [];
    const price = agentPricing.estimate(model);
    const holdPoints = Math.max(price.total, Number(process.env.AGENT_RESERVE_POINTS || 10));
    const reservePrice = { ...price, unit: holdPoints, total: holdPoints, unitRmb: holdPoints * wallet.pointValueRmb(), totalRmb: holdPoints * wallet.pointValueRmb() };
    const requestId = String(req.get('Idempotency-Key') || body.requestId || '').trim();
    const held = wallet.reserve(requestId, reservePrice);
    if (held.duplicate) {
      const prior = wallet.taskByRequest(requestId);
      if (prior?.state === 'charged' && prior.resultText) {
        return res.json({
          ok: true, recovered: true, provider: 'otterl',
          taskId: prior.taskId, requestId,
          model: prior.agentModel || model,
          providerModel: prior.providerModel || '',
          text: prior.resultText,
          quote: prior.quote || price,
          wallet: wallet.publicWallet(),
        });
      }
      if (prior?.state === 'reserved') {
        return res.status(202).json({
          ok: true, accepted: true, recovered: true, provider: 'otterl',
          taskId: prior.taskId, requestId,
          model: prior.agentModel || model,
          state: 'processing',
          wallet: wallet.publicWallet(),
        });
      }
      return res.status(409).json({ ok: false, error: '这个 Agent 请求已经提交，请勿重复点击', wallet: wallet.publicWallet() });
    }
    reservationId = held.reservation.id;
    billingTaskId = `agent-${crypto.randomUUID()}`;
    wallet.attachTasks(reservationId, [{ taskId: billingTaskId, taskApi: 'agent', model: `Agent · ${model}` }]);

    // 立即把任务编号交给浏览器，耗时的上游调用在后台继续。
    // 即使页面刷新、网络断开，仍可用 requestId 查询并找回结果。
    const userId = req.user.id;
    const agentInput = {
      model,
      metaPrompt: String(body.metaPrompt || '').trim(),
      userNeed: String(body.userNeed || '').trim(),
      skillName: String(body.skillName || '').trim(),
      skillContent: String(body.skillContent || '').trim(),
      contextTexts: Array.isArray(body.contextTexts) ? body.contextTexts.slice(0, 30) : [],
      rawImages,
    };
    setImmediate(() => wallet.runAs(userId, async () => {
      try {
        const imageUrls = await otterlChat.prepareImageUrls(agentInput.rawImages);
        const result = await otterlChat.runAgent({ ...agentInput, imageUrls });
        const actualQuote = agentPricing.quoteFromUsage(model, result.usage);
        wallet.settleVariableTask(billingTaskId, true, actualQuote.total, {
          providerCredits: result.providerCredits, usage: result.usage, quote: actualQuote, kind: 'agent',
          resultText: result.text, agentModel: model, providerModel: result.providerModel,
        });
      } catch (error) {
        wallet.settleVariableTask(billingTaskId, false, 0, { kind: 'agent', error: error?.message || 'Agent 调用失败' });
        console.warn('[agent background]', userId, billingTaskId, error?.message || error);
      }
    }));

    res.status(202).json({
      ok: true, accepted: true, provider: 'otterl',
      taskId: billingTaskId, requestId, model, state: 'processing',
      quote: price, wallet: wallet.publicWallet(),
    });
  } catch (error) {
    if (billingTaskId) wallet.settleVariableTask(billingTaskId, false, 0, { kind: 'agent', error: error?.message || 'Agent 调用失败' });
    else if (reservationId) wallet.releaseUnattached(reservationId, 'Agent 调用失败返还');
    safeJsonError(res, error);
  }
});

app.get('/api/agent/results/recent', (req, res) => {
  res.json({ ok: true, results: wallet.recentAgentResults(req.query.limit), wallet: wallet.publicWallet() });
});

app.get('/api/agent/status', (req, res) => {
  const requestId = String(req.query.requestId || '').trim();
  if (!requestId) return res.status(400).json({ ok: false, error: '缺少 Agent 请求编号' });
  const item = wallet.taskByRequest(requestId);
  if (!item || item.taskApi !== 'agent') return res.status(404).json({ ok: false, error: '没有找到这次 Agent 请求' });
  res.json({
    ok: true,
    task: {
      taskId: item.taskId,
      requestId: item.requestId || requestId,
      state: item.state,
      text: item.resultText || '',
      error: item.error || '',
      model: item.agentModel || String(item.model || '').replace(/^Agent\s*·\s*/, ''),
      quote: item.quote || null,
      createdAt: item.createdAt || 0,
      settledAt: item.settledAt || 0,
    },
    wallet: wallet.publicWallet(),
  });
});

app.get('/api/credits', async (req, res) => {
  try {
    const credits = await kie.getCredits();
    res.json({ ok: true, provider: 'kie', credits });
  } catch (error) {
    safeJsonError(res, error);
  }
});

app.get('/api/wallet', (req, res) => {
  res.json({ ok: true, wallet: wallet.publicWallet() });
});

app.get('/api/wallet/history', (req, res) => {
  res.json({ ok: true, wallet: wallet.publicWallet(), ledger: wallet.recentLedger(req.query.limit) });
});

app.get('/api/pricing', (req, res) => {
  res.json({ ok: true, prices: wallet.pricing(), pointValueRmb: wallet.pointValueRmb() });
});

app.get('/api/provider/otterl/pricing', async (req, res) => {
  try {
    res.json({ ok: true, multiplier: 2, prices: await otterlImage.getPublicPricing() });
  } catch (error) {
    safeJsonError(res, error);
  }
});

app.get('/api/pricing/quote', (req, res) => {
  try {
    const quote = wallet.quote({ model: req.query.model, resolution: req.query.resolution, count: req.query.count });
    res.json({ ok: true, quote, wallet: wallet.publicWallet() });
  } catch (error) {
    safeJsonError(res, error);
  }
});

app.get('/api/pricing/agent', (req, res) => {
  try {
    const model = String(req.query.model || '').replace(/^Agent · /, '');
    res.json({ ok: true, quote: agentPricing.estimate(model), wallet: wallet.publicWallet() });
  } catch (error) {
    safeJsonError(res, error);
  }
});

app.post('/api/image/generate', async (req, res) => {
  let reservationId = '';
  try {
    const body = req.body || {};
    const modelName = String(body.model || '').trim();
    const model = resolveModel(modelName);
    if (!model) {
      return res.status(400).json({
        ok: false,
        error: `V1 暂未接入模型：${modelName || '未选择'}`,
        supportedModels: listModels().map(x => x.name),
      });
    }
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ ok: false, error: 'Prompt 不能为空' });

    const requestedResolution = platformSettings.normalizeResolution(body.resolution) || model.fixedResolution || model.resolutions[0];
    if (!model.resolutions.includes(requestedResolution)) {
      return res.status(400).json({ ok: false, error: `${modelName} 不支持 ${requestedResolution}，可用分辨率：${model.resolutions.join('、')}` });
    }

    const price = wallet.quote({ model: modelName, resolution: requestedResolution, count: body.count });
    const requestId = String(req.get('Idempotency-Key') || body.requestId || '').trim();
    const held = wallet.reserve(requestId, price);
    if (held.duplicate) {
      return res.status(409).json({ ok: false, error: '这个生成请求已经提交，请勿重复点击', wallet: wallet.publicWallet() });
    }
    reservationId = held.reservation.id;
    const count = price.count;
    const rawImages = Array.isArray(body.images) ? body.images.slice(0, 14) : [];
    const mask = String(body.mask || '').trim();
    if (mask && !/^data:image\//i.test(mask)) {
      return res.status(400).json({ ok: false, error: '消除蒙版格式无效' });
    }
    const selectedProvider = selectImageProvider(modelName, model);
    const provider = selectedProvider.client;
    // Mock 完全离线；OtterL 的编辑接口直接接收原图；只有 KIE 需要先转为公网 URL。
    const imageUrls = selectedProvider.name === 'kie' ? await kie.prepareImageUrls(rawImages) : rawImages;
    const callbackUrl = (process.env.PUBLIC_BASE_URL || '').trim()
      ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/callback/kie`
      : '';

    const tasks = [];
    const warnings = new Set();
    if (selectedProvider.warning) warnings.add(selectedProvider.warning);
    const createdResults = await Promise.allSettled(Array.from({ length: count }, () =>
      provider.createImageTask({
          modelName,
          prompt,
          aspectRatio: body.aspectRatio,
          resolution: body.resolution,
          imageUrls,
          maskUrl: mask,
          background: body.background,
          operation: body.operation,
          callbackUrl,
      })
    ));
    let createError = null;
    for (const result of createdResults) {
      if (result.status === 'fulfilled') {
        const created = result.value;
        created.warnings.forEach(w => warnings.add(w));
        tasks.push({ taskId: created.taskId, providerModel: created.model, taskApi: created.taskApi || 'market' });
      } else {
        createError ||= result.reason;
      }
    }

    wallet.attachTasks(reservationId, tasks.map(task => ({ taskId: task.taskId, taskApi: task.taskApi, model: modelName })));
    if (!tasks.length && createError) throw createError;
    if (createError) warnings.add(`部分任务未提交：${createError.message}`);

    res.json({
      ok: true,
      provider: selectedProvider.name,
      model: modelName,
      tasks,
      warnings: [...warnings],
      quote: { ...price, count: tasks.length, total: price.unit * tasks.length },
      wallet: wallet.publicWallet(),
    });
  } catch (error) {
    if (reservationId) wallet.releaseUnattached(reservationId);
    safeJsonError(res, error);
  }
});

app.get('/api/task/:taskId', async (req, res) => {
  try {
    if (!wallet.hasTask(req.params.taskId)) {
      return res.status(404).json({ ok: false, error: '当前账号没有这个图片任务' });
    }
    const taskApi = req.query.api === 'mock' ? 'mock' : req.query.api === 'gpt4o' ? 'gpt4o' : req.query.api === 'otterl' ? 'otterl' : 'market';
    const selectedProvider = providerFromTaskApi(taskApi);
    const task = await selectedProvider.client.getTask(req.params.taskId, taskApi);
    let urls = task.resultUrls;
    // OtterL provider 已自行做后台持久化。这里再次同步下载会让“上游已完成”后
    // 画布仍额外等待 15 秒甚至更久，因此 OtterL 临时地址直接返回给浏览器。
    if (task.state === 'success' && urls.length && taskApi !== 'otterl') {
      urls = await cacheRemoteResults(task.taskId, urls);
    }
    // 上游成功并返回图片地址就立即按成功结算，避免浏览器确认异常导致平台替客户承担上游成本。
    if (task.state === 'success' && urls.length) wallet.settleTask(task.taskId, true, { providerCredits: task.creditsConsumed, resultUrls: urls, providerModel: task.model });
    if (task.state === 'fail') wallet.settleTask(task.taskId, false, { failCode: task.failCode });
    const base = `${req.protocol}://${req.get('host')}`;
    const absoluteUrls = urls.map(url => url.startsWith('/') ? `${base}${url}` : url);
    res.json({
      ok: true,
      provider: selectedProvider.name,
      taskId: task.taskId,
      model: task.model,
      state: task.state,
      progress: task.progress,
      urls: absoluteUrls,
      failCode: task.failCode,
      failMsg: task.failMsg,
      costTime: task.costTime,
      creditsConsumed: task.creditsConsumed,
      billingEligible: task.billingEligible !== false,
      resolution: task.resolution || '1K',
      aspectRatio: task.aspectRatio || 'auto',
      wallet: wallet.publicWallet(),
    });
  } catch (error) {
    safeJsonError(res, error);
  }
});

// Generated images are frequently returned from a different origin. Browsers ignore
// the download attribute for those URLs and open the image instead. Proxy only an
// image that belongs to the signed-in user's task so the canvas can download/export
// it without exposing an arbitrary URL fetch endpoint.
app.get('/api/task/:taskId/image', async (req, res) => {
  try {
    if (!wallet.hasTask(req.params.taskId)) {
      return res.status(404).json({ ok: false, error: '当前账号没有这个图片任务' });
    }
    const taskApi = req.query.api === 'mock' ? 'mock' : req.query.api === 'gpt4o' ? 'gpt4o' : req.query.api === 'otterl' ? 'otterl' : 'market';
    const selectedProvider = providerFromTaskApi(taskApi);
    const task = await selectedProvider.client.getTask(req.params.taskId, taskApi);
    if (task.state !== 'success' || !Array.isArray(task.resultUrls) || !task.resultUrls.length) {
      return res.status(409).json({ ok: false, error: '图片任务尚未成功，暂时不能下载' });
    }
    const requestedIndex = Math.max(0, Math.floor(Number(req.query.index) || 0));
    const sourceUrl = String(task.resultUrls[Math.min(requestedIndex, task.resultUrls.length - 1)] || '');
    if (!sourceUrl) return res.status(404).json({ ok: false, error: '未找到可下载的图片' });

    if (sourceUrl.startsWith('/generated/')) {
      const fileName = path.basename(decodeURIComponent(sourceUrl.slice('/generated/'.length)));
      const filePath = path.join(GENERATED_DIR, fileName);
      if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: '本地图片文件已丢失，请使用找回结果' });
      res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
      return res.sendFile(filePath);
    }

    const dataImage = sourceUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (dataImage) {
      const buffer = Buffer.from(dataImage[2].replace(/\s+/g, ''), 'base64');
      if (!buffer.length) return res.status(404).json({ ok: false, error: '图片数据为空' });
      if (buffer.length > 80 * 1024 * 1024) return res.status(413).json({ ok: false, error: '图片超过 80MB，无法在画布中导出' });
      res.setHeader('Content-Type', dataImage[1]);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
      return res.send(buffer);
    }

    if (!/^https?:\/\//i.test(sourceUrl)) {
      return res.status(400).json({ ok: false, error: '图片地址无效' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      const headers = { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 kai-image-download/1.0' };
      if (taskApi === 'otterl') {
        try {
          const otterlOrigin = new URL(process.env.OTTERL_BASE_URL || 'https://otterl.com/v1').origin;
          if (new URL(sourceUrl).origin === otterlOrigin && String(process.env.OTTERL_API_KEY || '').trim()) {
            headers.Authorization = `Bearer ${String(process.env.OTTERL_API_KEY).trim()}`;
          }
        } catch {}
      }
      response = await fetch(sourceUrl, { signal: controller.signal, redirect: 'follow', headers });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw Object.assign(new Error(`下载上游图片失败：HTTP ${response.status}`), { statusCode: 502 });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw Object.assign(new Error('上游返回了空图片'), { statusCode: 502 });
    if (buffer.length > 80 * 1024 * 1024) throw Object.assign(new Error('图片超过 80MB，无法在画布中导出'), { statusCode: 413 });
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    res.send(buffer);
  } catch (error) {
    safeJsonError(res, error);
  }
});

app.post('/api/task/:taskId/confirm-delivery', async (req, res) => {
  try {
    if (!wallet.hasTask(req.params.taskId)) {
      return res.status(404).json({ ok: false, error: '当前账号没有这个图片任务' });
    }
    const taskApi = req.query.api === 'mock' ? 'mock' : req.query.api === 'gpt4o' ? 'gpt4o' : req.query.api === 'otterl' ? 'otterl' : 'market';
    const selectedProvider = providerFromTaskApi(taskApi);
    const task = await selectedProvider.client.getTask(req.params.taskId, taskApi);
    if (task.state !== 'success' || !Array.isArray(task.resultUrls) || !task.resultUrls.length) {
      return res.status(409).json({ ok: false, error: '图片任务尚未成功，不能确认交付', wallet: wallet.publicWallet() });
    }
    const width = Math.max(0, Number(req.body?.width) || 0);
    const height = Math.max(0, Number(req.body?.height) || 0);
    const longest = Math.max(width, height);
    const resolution = String(task.resolution || '1K').toUpperCase();
    const minimum = resolution === '4K' ? 3500 : resolution === '2K' ? 1800 : 700;
    if (!width || !height || longest < minimum) {
      const nextWallet = wallet.settleTask(task.taskId, true, {
        providerCredits: task.creditsConsumed,
        resultUrls: task.resultUrls,
        providerModel: task.model,
        deliveryConfirmed: true,
        deliveryWarning: 'DELIVERY_PIXEL_CHECK_FAILED',
        width,
        height,
        resolution,
      });
      return res.json({ ok: true, charged: true, code: 'DELIVERY_PIXEL_CHECK_FAILED', warning: `图片已生成并交付，但像素未达到 ${resolution} 要求（实际 ${width}×${height}），已正常扣除积分`, taskId: task.taskId, width, height, resolution, wallet: nextWallet });
    }
    const requestedRatio = String(task.aspectRatio || 'auto');
    const ratioMatch = requestedRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (ratioMatch) {
      const expectedRatio = Number(ratioMatch[1]) / Number(ratioMatch[2]);
      const actualRatio = width / height;
      const deviation = Math.abs(actualRatio - expectedRatio) / expectedRatio;
      if (deviation > 0.025) {
        const nextWallet = wallet.settleTask(task.taskId, true, {
          providerCredits: task.creditsConsumed,
          resultUrls: task.resultUrls,
          providerModel: task.model,
          deliveryConfirmed: true,
          deliveryWarning: 'DELIVERY_RATIO_CHECK_FAILED',
          width,
          height,
          requestedRatio,
        });
        return res.json({ ok: true, charged: true, code: 'DELIVERY_RATIO_CHECK_FAILED', warning: `图片已生成并交付，但上游未按 ${requestedRatio} 输出（实际 ${width}×${height}），已正常扣除积分`, taskId: task.taskId, width, height, resolution, wallet: nextWallet });
      }
    }
    const urls = await cacheRemoteResults(task.taskId, task.resultUrls);
    const nextWallet = wallet.settleTask(task.taskId, true, {
      providerCredits: task.creditsConsumed,
      resultUrls: urls,
      providerModel: task.model,
      deliveryConfirmed: true,
      width,
      height,
      resolution,
    });
    res.json({ ok: true, charged: true, taskId: task.taskId, width, height, resolution, wallet: nextWallet });
  } catch (error) {
    safeJsonError(res, error);
  }
});

app.get('/api/tasks/stream', (req, res) => {
  const parseItems = (value, limit = 24) => {
    try {
      const parsed = JSON.parse(String(value || '[]'));
      return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
    } catch { return []; }
  };
  const requestedImages = parseItems(req.query.images).filter(item => item?.taskId);
  const requestedAgents = parseItems(req.query.agents).map(String).filter(Boolean);
  const userId = req.user.id;
  let closed = false;
  let checking = false;
  const lastStates = new Map();

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 2000\n\n');

  const emit = payload => {
    if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const tick = async () => {
    if (closed || checking) return;
    checking = true;
    try {
      await wallet.runAs(userId, async () => {
        const ownedTaskIds = new Set(wallet.recentTasks(100).map(item => item.taskId));
        for (const item of requestedImages) {
          const taskId = String(item.taskId || '');
          if (!ownedTaskIds.has(taskId)) continue;
          try {
            const taskApi = ['mock', 'gpt4o', 'otterl'].includes(item.taskApi) ? item.taskApi : 'market';
            const selectedProvider = providerFromTaskApi(taskApi);
            const task = await selectedProvider.client.getTask(taskId, taskApi);
            const state = String(task.state || 'waiting');
            const key = `image:${taskId}`;
            if (lastStates.get(key) !== state) {
              lastStates.set(key, state);
              emit({ kind: 'image', taskId, taskApi, state, progress: Number(task.progress || 0) });
            }
          } catch (error) {
            const key = `image:${taskId}`;
            if (lastStates.get(key) !== 'unavailable') {
              lastStates.set(key, 'unavailable');
              emit({ kind: 'image', taskId, state: 'unavailable' });
            }
          }
        }
        for (const requestId of requestedAgents) {
          const item = wallet.taskByRequest(requestId);
          if (!item || item.taskApi !== 'agent') continue;
          const state = String(item.state || 'reserved');
          const key = `agent:${requestId}`;
          if (lastStates.get(key) !== state) {
            lastStates.set(key, state);
            emit({ kind: 'agent', requestId, taskId: item.taskId, state });
          }
        }
      });
    } finally { checking = false; }
  };
  const pollTimer = setInterval(tick, 1500);
  const heartbeatTimer = setInterval(() => { if (!closed && !res.writableEnded) res.write(': heartbeat\n\n'); }, 15000);
  tick();
  req.on('close', () => {
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
  });
});

app.get('/api/tasks/recent', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const tasks = wallet.recentTasks(req.query.limit).map(item => ({
    ...item,
    resultUrls: (Array.isArray(item.resultUrls) ? item.resultUrls : []).map(url => String(url).startsWith('/') ? `${base}${url}` : url),
  }));
  res.json({ ok: true, tasks });
});

let reconcilingWallet = false;
const taskFreezeTimeoutMinutes = Math.max(1, Math.min(1440, Number(process.env.TASK_FREEZE_TIMEOUT_MINUTES) || 20));
const taskFreezeTimeoutMs = taskFreezeTimeoutMinutes * 60 * 1000;
async function reconcileWalletTasks() {
  if (reconcilingWallet) return;
  reconcilingWallet = true;
  try {
    for (const userId of wallet.listUserIds()) await wallet.runAs(userId, async () => {
      for (const item of wallet.pendingTasks().slice(0, 20)) {
        try {
          const selectedProvider = providerFromTaskApi(item.taskApi || 'market');
          const task = await selectedProvider.client.getTask(item.taskId, item.taskApi || 'market');
          if (task.state === 'success' && task.resultUrls?.length && task.billingEligible !== false) {
            const urls = task.resultUrls?.length ? await cacheRemoteResults(task.taskId, task.resultUrls) : [];
            wallet.settleTask(task.taskId, true, { providerCredits: task.creditsConsumed, resultUrls: urls, providerModel: task.model });
          }
          if (task.state === 'fail') wallet.settleTask(task.taskId, false, { failCode: task.failCode });
        } catch (error) {
          console.warn('[wallet reconcile]', userId, item.taskId, error.message);
        }
      }
      // 必须先查询上游并结算成功任务，再处理真正过期的任务；否则恰好跨过
      // 超时点的成功任务会先被返还，造成上游已扣费而客户未扣积分。
      const expired = wallet.releaseExpiredTasks(taskFreezeTimeoutMs);
      if (expired.releasedPoints) console.warn('[wallet timeout release]', userId, expired.releasedPoints, 'points');
    });
  } finally {
    reconcilingWallet = false;
  }
}
setInterval(reconcileWalletTasks, 30000).unref();
setTimeout(reconcileWalletTasks, 1500).unref();

app.post('/api/callback/kie', (req, res) => {
  // V1 本地开发主要使用轮询。部署公网后可以在这里写入数据库并主动更新任务。
  console.log('[Kie callback]', JSON.stringify(req.body).slice(0, 1200));
  res.json({ ok: true });
});

app.use('/generated', express.static(GENERATED_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Railway and other container platforms must listen on every network interface.
// Binding to 0.0.0.0 also works locally and prevents a stale HOST=127.0.0.1
// environment value from making the deployed service unreachable.
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\nxiaokai Kie V1 已启动： http://${HOST}:${PORT}`);
  console.log(`Kie Key：${process.env.KIE_API_KEY ? '已配置' : '未配置（请编辑 .env）'}`);
  console.log(`OtterL Key：${process.env.OTTERL_API_KEY ? '已配置' : '未配置（自动继续使用 KIE）'}`);
  console.log(`图片线路：${preferredImageProvider()}`);
  console.log('请从上面的地址打开画布，不要直接双击 HTML。\n');
});
