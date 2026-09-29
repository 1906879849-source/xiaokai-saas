const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const tasks = new Map();
const GENERATED_DIR = process.env.GENERATED_DIR ? path.resolve(process.env.GENERATED_DIR) : path.join(__dirname, '..', '..', 'generated');

const MODEL_IDS = {
  'GPT Image 2': 'gpt-image-2',
  'GPT Image 2 · 4K 超分': 'gpt-image-2-4k超分',
  'GPT Image 2 · 原生 4K': 'gpt-image-2-原生4k',
  'GPT Image 2.5 Flare': 'gpt-image-2.5-flare',
  'GPT Image 2.5 Sunburst': 'gpt-image-2.5-sunburst',
  'Gemini 3 Pro Image': 'gemini-3-pro-image-preview',
  'Gemini 3.1 Flash Image': 'gemini-3.1-flash-image-preview',
};

const FIXED_4K_MODELS = new Set(['GPT Image 2 · 4K 超分', 'GPT Image 2 · 原生 4K']);

function apiBase() {
  return (process.env.OTTERL_BASE_URL || 'https://otterl.com/v1').replace(/\/$/, '');
}

function apiKey() {
  const key = String(process.env.OTTERL_API_KEY || '').trim();
  if (!key) {
    const error = new Error('OTTERL_API_KEY 未配置。请在本机 .env 中填写，不要把密钥发到聊天里。');
    error.statusCode = 503;
    throw error;
  }
  return key;
}

function supportsModel(modelName) {
  return Boolean(MODEL_IDS[modelName]);
}

function configured() {
  return Boolean(String(process.env.OTTERL_API_KEY || '').trim());
}

function normalizeAspectRatio(value) {
  const ratio = String(value || '').trim();
  return /^\d+:\d+$/.test(ratio) ? ratio : 'auto';
}

function normalizeResolution(value) {
  const resolution = String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  return ['1K', '2K', '4K'].includes(resolution) ? resolution : '1K';
}

function openAiImageOptions(aspectRatio, resolution) {
  const portrait = new Set(['9:16', '3:4', '2:3', '4:5']);
  const landscape = new Set(['16:9', '4:3', '3:2', '5:4', '21:9']);
  const size = portrait.has(aspectRatio)
    ? '1024x1536'
    : landscape.has(aspectRatio)
      ? '1536x1024'
      : '1024x1024';
  const quality = resolution === '4K' ? 'high' : resolution === '2K' ? 'medium' : 'low';
  return { size, quality };
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) throw new Error('参考图 Data URL 格式无效');
  return new Blob([Buffer.from(match[2], 'base64')], { type: match[1] || 'image/png' });
}

function fileExtension(contentType = '') {
  if (/jpe?g/i.test(contentType)) return 'jpg';
  if (/webp/i.test(contentType)) return 'webp';
  if (/gif/i.test(contentType)) return 'gif';
  return 'png';
}

async function imageToBlob(source) {
  const value = String(source || '').trim();
  if (/^data:image\//i.test(value)) return dataUrlToBlob(value);
  if (!/^https?:\/\//i.test(value)) throw new Error('参考图地址无效');
  const response = await fetch(value);
  if (!response.ok) throw new Error(`读取参考图失败：HTTP ${response.status}`);
  return new Blob([await response.arrayBuffer()], {
    type: response.headers.get('content-type') || 'image/png',
  });
}

async function otterFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12 * 60 * 1000);
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
    let json;
    try { json = text ? JSON.parse(text) : {}; }
    catch { json = { error: { message: text || `HTTP ${response.status}` } }; }
    if (!response.ok) {
      const message = json?.error?.message || json?.message || json?.msg || `OtterL HTTP ${response.status}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.payload = json;
      throw error;
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function getPublicPricing() {
  const origin = new URL(apiBase()).origin;
  const response = await fetch(`${origin}/api/pricing`);
  if (!response.ok) throw new Error(`读取 OtterL 定价失败：HTTP ${response.status}`);
  const json = await response.json();
  return (Array.isArray(json?.data) ? json.data : [])
    .filter(item => Number(item?.quota_type) === 1)
    .map(item => ({
      model: item.model_name,
      priceRmb: Number(item.model_price || 0),
      userPriceRmb: Number((Number(item.model_price || 0) * 2).toFixed(2)),
      endpoints: item.supported_endpoint_types || [],
    }));
}

function extractResultUrls(json) {
  const data = Array.isArray(json?.data) ? json.data : [];
  return data.map(item => {
    if (item?.url) return item.url;
    if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    return '';
  }).filter(Boolean);
}

async function runTask(task) {
  task.state = 'generating';
  task.progress = 8;
  try {
    const common = {
      model: task.model,
      prompt: task.prompt,
      n: 1,
      response_format: 'url',
      ...openAiImageOptions(task.aspectRatio, task.resolution),
    };
    let json;
    if (task.imageUrls.length) {
      const form = new FormData();
      Object.entries(common).forEach(([key, value]) => form.append(key, String(value)));
      for (let index = 0; index < task.imageUrls.length; index += 1) {
        const blob = await imageToBlob(task.imageUrls[index]);
        const ext = fileExtension(blob.type);
        form.append('image[]', blob, `reference-${index + 1}.${ext}`);
      }
      task.progress = 18;
      json = await otterFetch('/images/edits', { method: 'POST', body: form });
    } else {
      json = await otterFetch('/images/generations', {
        method: 'POST',
        body: JSON.stringify(common),
      });
    }
    const urls = extractResultUrls(json);
    if (!urls.length) throw new Error('OtterL 返回成功，但没有可用的图片结果');
    task.resultUrls = urls;
    task.state = 'success';
    task.progress = 100;
    task.creditsConsumed = json?.usage?.total_tokens ?? null;
  } catch (error) {
    task.state = 'fail';
    task.progress = 100;
    task.failCode = error?.name === 'AbortError' ? 'OTTERL_TIMEOUT' : 'OTTERL_GENERATION_FAILED';
    task.failMsg = error?.name === 'AbortError' ? 'OtterL 生成超时' : (error?.message || 'OtterL 图片生成失败');
  } finally {
    task.finishedAt = Date.now();
  }
}

async function createImageTask({ modelName, prompt, aspectRatio, resolution, imageUrls = [] }) {
  const normalizedResolution = FIXED_4K_MODELS.has(modelName) ? '4K' : normalizeResolution(resolution);
  const model = MODEL_IDS[modelName];
  if (!model) {
    const error = new Error(`OtterL 暂未映射模型：${modelName}`);
    error.statusCode = 400;
    throw error;
  }
  apiKey();
  const taskId = `otterl-${crypto.randomUUID()}`;
  const task = {
    taskId,
    model,
    prompt: String(prompt || '').trim(),
    aspectRatio: normalizeAspectRatio(aspectRatio),
    resolution: normalizedResolution,
    imageUrls: Array.isArray(imageUrls) ? imageUrls.slice(0, 10) : [],
    state: 'waiting',
    progress: 2,
    resultUrls: [],
    failCode: '',
    failMsg: '',
    creditsConsumed: null,
    createdAt: Date.now(),
    finishedAt: 0,
  };
  tasks.set(taskId, task);
  setImmediate(() => runTask(task));
  return { taskId, model, taskApi: 'otterl', warnings: [] };
}

async function getTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    const prefix = `${String(taskId).replace(/[^a-zA-Z0-9_-]/g, '_')}-`;
    const recovered = fs.existsSync(GENERATED_DIR)
      ? fs.readdirSync(GENERATED_DIR).filter(name => name.startsWith(prefix)).sort()
      : [];
    if (recovered.length) {
      return {
        taskId,
        model: 'otterl-recovered-image',
        state: 'success',
        progress: 100,
        resultUrls: recovered.map(name => `/generated/${encodeURIComponent(name)}`),
        failCode: '',
        failMsg: '',
        costTime: 0,
        creditsConsumed: null,
      };
    }
    const error = new Error('OtterL 任务结果尚未缓存，且本地服务可能在生成期间重启过。');
    error.statusCode = 404;
    throw error;
  }
  return {
    taskId: task.taskId,
    model: task.model,
    state: task.state,
    progress: task.progress,
    resultUrls: task.resultUrls,
    failCode: task.failCode,
    failMsg: task.failMsg,
    costTime: (task.finishedAt || Date.now()) - task.createdAt,
    creditsConsumed: task.creditsConsumed,
  };
}

module.exports = { configured, supportsModel, createImageTask, getTask, getPublicPricing };
