const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const platformSettings = require('../platform-settings');

const DATA_ROOT = path.resolve(process.env.IMAGE_TASK_DATA_DIR || process.env.WALLET_DATA_DIR || process.env.ACCOUNT_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const TASK_DIR = path.join(DATA_ROOT, 'rivo-image-tasks');
const memoryTasks = new Map();
fs.mkdirSync(TASK_DIR, { recursive: true });

function apiBase() {
  return String(process.env.RIVO_BASE_URL || 'https://api.rivoapi.com/v1').trim().replace(/\/$/, '');
}

function apiKey() {
  const key = String(process.env.RIVO_API_KEY || '').trim();
  if (!key) {
    const error = new Error('RIVO_API_KEY 未配置。请在 Railway Variables 中填写，不要上传到代码仓库。');
    error.statusCode = 503;
    throw error;
  }
  return key;
}

function configured() { return Boolean(String(process.env.RIVO_API_KEY || '').trim()); }
function supportsModel(name) { return platformSettings.resolveModel(name)?.provider === 'rivo'; }
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140); }
function taskFile(id) { return path.join(TASK_DIR, `${safeId(id)}.json`); }

function persist(task) {
  const file = taskFile(task.taskId), temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(task, null, 2));
  fs.renameSync(temp, file);
}

function load(taskId) {
  if (memoryTasks.has(taskId)) return memoryTasks.get(taskId);
  const file = taskFile(taskId);
  if (!fs.existsSync(file)) return null;
  try {
    const task = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (task?.taskId !== taskId) return null;
    memoryTasks.set(taskId, task);
    return task;
  } catch { return null; }
}

function normalizeResolution(value) {
  const resolution = String(value || '').trim().toUpperCase();
  return ['1K', '2K', '4K'].includes(resolution) ? resolution : '1K';
}

function parsedRatio(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return 1;
  const width = Number(match[1]), height = Number(match[2]);
  return width > 0 && height > 0 ? Math.max(1 / 3, Math.min(3, width / height)) : 1;
}

function divisible16(value) { return Math.max(16, Math.round(value / 16) * 16); }

function imageSize(aspectRatio, resolution) {
  const ratio = parsedRatio(aspectRatio);
  const targetPixels = resolution === '4K' ? 8294400 : resolution === '2K' ? 4194304 : 1048576;
  let width = Math.sqrt(targetPixels * ratio);
  let height = width / ratio;
  const longest = Math.max(width, height);
  if (longest > 3840) {
    const scale = 3840 / longest;
    width *= scale; height *= scale;
  }
  width = divisible16(width); height = divisible16(height);
  while (width * height > 8294400) {
    if (width >= height) width -= 16; else height -= 16;
  }
  return `${width}x${height}`;
}

function dataUrlBlob(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  return new Blob([Buffer.from(match[2], 'base64')], { type: match[1] || 'image/png' });
}

async function referenceBlob(value, referenceHost, referenceCookie) {
  const inline = dataUrlBlob(value);
  if (inline) return inline;
  if (!/^https?:\/\//i.test(String(value || ''))) throw new Error('参考图地址无效');
  const headers = {};
  try { if (referenceHost && new URL(value).host === referenceHost && referenceCookie) headers.Cookie = referenceCookie; } catch {}
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(value, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Blob([await response.arrayBuffer()], { type: response.headers.get('content-type') || 'image/png' });
  } finally { clearTimeout(timer); }
}

async function rivoFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
  try {
    const response = await fetch(`${apiBase()}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { error: { message: text } }; }
    if (!response.ok) {
      const error = new Error(json?.error?.message || json?.message || `Rivo HTTP ${response.status}`);
      error.statusCode = response.status; error.payload = json; throw error;
    }
    return json;
  } finally { clearTimeout(timer); }
}

function resultUrls(json) {
  return (Array.isArray(json?.data) ? json.data : []).map(item => item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '')).filter(Boolean);
}

function upstreamId(json) {
  return String(json?.id || json?.task_id || json?.data?.[0]?.id || json?.data?.[0]?.task_id || '').trim();
}

function friendlyError(error) {
  const status = Number(error?.statusCode || 0);
  if (status === 429) return 'Rivo 请求过于频繁（HTTP 429），请稍后重试或提高该密钥的速率限制';
  if ([502, 503, 504].includes(status)) return `Rivo 上游暂时不可用（HTTP ${status}），本次失败不扣积分`;
  return String(error?.message || 'Rivo 图片生成失败').replace(/\s+/g, ' ').slice(0, 400);
}

async function createImageTask({ modelName, prompt, aspectRatio, resolution, imageUrls = [], referenceHost = '', referenceCookie = '', maskUrl = '', background = '' }) {
  const spec = platformSettings.resolveModel(modelName);
  if (!spec || spec.provider !== 'rivo') throw Object.assign(new Error(`Rivo 暂未映射模型：${modelName}`), { statusCode: 400 });
  apiKey();
  const normalizedResolution = normalizeResolution(resolution);
  if (!spec.resolutions.includes(normalizedResolution)) throw Object.assign(new Error(`${modelName} 不支持 ${normalizedResolution}`), { statusCode: 400 });
  const editing = Array.isArray(imageUrls) && imageUrls.length > 0;
  const endpoint = editing ? '/images/edits' : '/images/generations';
  const size = imageSize(aspectRatio, normalizedResolution);
  let body;
  if (editing) {
    body = new FormData();
    body.append('model', spec.id);
    body.append('prompt', String(prompt || ''));
    body.append('size', size);
    body.append('quality', String(process.env.RIVO_IMAGE_QUALITY || 'standard'));
    body.append('background', /透明|transparent/i.test(String(background || '')) ? 'transparent' : 'auto');
    body.append('output_format', 'png');
    body.append('async', 'true');
    for (let index = 0; index < imageUrls.slice(0, 14).length; index += 1) {
      const blob = await referenceBlob(imageUrls[index], referenceHost, referenceCookie);
      body.append('image[]', blob, `reference-${index + 1}.png`);
    }
    if (maskUrl) {
      const mask = await referenceBlob(maskUrl, referenceHost, referenceCookie);
      body.append('mask', mask, 'mask.png');
    }
  } else {
    body = JSON.stringify({ model: spec.id, prompt: String(prompt || ''), size, quality: String(process.env.RIVO_IMAGE_QUALITY || 'standard'), background: /透明|transparent/i.test(String(background || '')) ? 'transparent' : 'auto', output_format: 'png', n: 1, async: true });
  }
  const response = await rivoFetch(endpoint, { method: 'POST', body });
  const localId = `rivo-${crypto.randomUUID()}`;
  const task = {
    taskId: localId, upstreamTaskId: upstreamId(response), endpoint, modelName, model: spec.id,
    resolution: normalizedResolution, aspectRatio: String(aspectRatio || 'auto'), size,
    state: 'waiting', progress: 2, resultUrls: resultUrls(response), failCode: '', failMsg: '',
    billingEligible: true, createdAt: Date.now(), finishedAt: 0,
  };
  if (task.resultUrls.length) { task.state = 'success'; task.progress = 100; task.finishedAt = Date.now(); }
  if (!task.upstreamTaskId && task.state !== 'success') throw new Error('Rivo 没有返回异步任务 ID');
  memoryTasks.set(localId, task); persist(task);
  return { taskId: localId, model: spec.id, taskApi: 'rivo', warnings: [] };
}

async function getTask(taskId) {
  const task = load(taskId);
  if (!task) throw Object.assign(new Error('Rivo 任务不存在或尚未保存'), { statusCode: 404 });
  if (!['success', 'fail'].includes(task.state)) {
    try {
      const response = await rivoFetch(`${task.endpoint}/${encodeURIComponent(task.upstreamTaskId)}`, { timeoutMs: 30000 });
      const status = String(response?.status || '').toLowerCase();
      if (['succeeded', 'completed', 'success'].includes(status)) {
        task.state = 'success'; task.progress = 100; task.resultUrls = resultUrls(response); task.finishedAt = Date.now();
        if (!task.resultUrls.length) throw new Error('Rivo 任务成功但没有返回图片地址');
      } else if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        task.state = 'fail'; task.progress = 100; task.failCode = String(response?.error?.code || 'RIVO_GENERATION_FAILED');
        task.failMsg = String(response?.error?.message || response?.message || 'Rivo 图片生成失败'); task.finishedAt = Date.now();
      } else {
        task.state = status === 'processing' || status === 'in_progress' ? 'generating' : 'waiting';
        task.progress = Math.max(task.progress || 2, task.state === 'generating' ? 35 : 5);
      }
    } catch (error) {
      if (Number(error?.statusCode || 0) >= 400 && Number(error?.statusCode || 0) < 500 && Number(error?.statusCode) !== 429) {
        task.state = 'fail'; task.progress = 100; task.failCode = `RIVO_HTTP_${error.statusCode}`; task.failMsg = friendlyError(error); task.finishedAt = Date.now();
      } else { throw error; }
    }
    persist(task);
  }
  return {
    taskId: task.taskId, model: task.model, state: task.state, progress: task.progress,
    resultUrls: task.resultUrls || [], failCode: task.failCode || '', failMsg: task.failMsg || '',
    costTime: (task.finishedAt || Date.now()) - task.createdAt, creditsConsumed: null,
    billingEligible: task.billingEligible !== false, resolution: task.resolution, aspectRatio: task.aspectRatio,
  };
}

module.exports = { configured, supportsModel, createImageTask, getTask, imageSize };
