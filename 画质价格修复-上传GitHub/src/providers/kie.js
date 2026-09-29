const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const API_BASE = () => (process.env.KIE_API_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '');
const UPLOAD_BASE = () => (process.env.KIE_UPLOAD_BASE_URL || 'https://kieai.redpandaai.co').replace(/\/$/, '');
const GENERATED_DIR = path.join(__dirname, '..', '..', 'generated');
const uploadCache = new Map();
const UPLOAD_CACHE_TTL = 6 * 60 * 60 * 1000;

function apiKey() {
  const key = (process.env.KIE_API_KEY || '').trim();
  if (!key) {
    const err = new Error('KIE_API_KEY 未配置，请先复制 .env.example 为 .env 并填写密钥。');
    err.statusCode = 503;
    throw err;
  }
  return key;
}

async function kieFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; }
    catch { json = { msg: text || `HTTP ${res.status}` }; }
    if (!res.ok) {
      const err = new Error(json?.msg || json?.message || `Kie HTTP ${res.status}`);
      err.statusCode = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCredits() {
  const json = await kieFetch(`${API_BASE()}/api/v1/chat/credit`, { method: 'GET' });
  return json?.data;
}

function sanitizeFileName(name = 'image.png') {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'image.png';
}

async function uploadBase64(dataUrl, fileName = `xiaokai-${Date.now()}.png`) {
  const json = await kieFetch(`${UPLOAD_BASE()}/api/file-base64-upload`, {
    method: 'POST',
    body: JSON.stringify({
      base64Data: dataUrl,
      uploadPath: 'images/xiaokai',
      fileName: sanitizeFileName(fileName),
    }),
    timeoutMs: 60000,
  });
  const url = json?.data?.downloadUrl || json?.data?.fileUrl;
  if (!url) throw new Error(json?.msg || 'Kie 图片上传成功但未返回可用 URL');
  return url;
}

async function uploadBase64Cached(dataUrl, fileName) {
  const digest = crypto.createHash('sha1').update(dataUrl).digest('hex');
  const cached = uploadCache.get(digest);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = uploadBase64(dataUrl, fileName).catch(error => {
    uploadCache.delete(digest);
    throw error;
  });
  uploadCache.set(digest, { promise, expiresAt: Date.now() + UPLOAD_CACHE_TTL });
  return promise;
}

function localGeneratedDataUrl(src) {
  try {
    const url = new URL(src);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/generated/')) return '';
    const fileName = path.basename(decodeURIComponent(url.pathname));
    const filePath = path.join(GENERATED_DIR, fileName);
    if (!fs.existsSync(filePath)) return '';
    const ext = path.extname(fileName).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch { return ''; }
}

async function prepareImageUrls(images = []) {
  const prepared = await Promise.all(images.map(async (image, index) => {
    if (typeof image !== 'string' || !image.trim()) return '';
    const src = image.trim();
    if (/^data:image\//i.test(src)) {
      return uploadBase64Cached(src, `xiaokai-input-${Date.now()}-${index + 1}.png`);
    } else if (/^https?:\/\//i.test(src)) {
      const localData = localGeneratedDataUrl(src);
      return localData
        ? uploadBase64Cached(localData, `xiaokai-local-${Date.now()}-${index + 1}.png`)
        : src;
    }
    return '';
  }));
  return prepared.filter(Boolean);
}

function normalizeAspectRatio(value) {
  const v = String(value || '').trim();
  if (!v || v === '自适应' || v === '自定义') return 'auto';
  const allowed = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']);
  return allowed.has(v) ? v : 'auto';
}

function normalizeResolution(value) {
  const v = String(value || '').replace(/[^0-9Kk]/g, '').toUpperCase();
  return ['1K', '2K', '4K'].includes(v) ? v : '2K';
}

function buildTaskPayload({ modelName, prompt, aspectRatio, resolution, imageUrls = [], callbackUrl = '' }) {
  const ratio = normalizeAspectRatio(aspectRatio);
  const res = normalizeResolution(resolution);
  const common = callbackUrl ? { callBackUrl: callbackUrl } : {};

  if (modelName === 'GPT-4o Image') {
    const supportedRatio = new Set(['1:1', '3:2', '2:3']).has(ratio) ? ratio : '1:1';
    return {
      endpoint: '/api/v1/gpt4o-image/generate',
      taskApi: 'gpt4o',
      body: {
        prompt,
        size: supportedRatio,
        filesUrl: imageUrls.slice(0, 5),
        ...(callbackUrl ? { callBackUrl: callbackUrl } : {}),
      },
      warnings: supportedRatio === ratio ? [] : [`GPT-4o Image 仅支持 1:1、3:2、2:3，本次已改用 ${supportedRatio}`],
    };
  }

  if (modelName === 'GPT Image 1.5') {
    const hasImages = imageUrls.length > 0;
    const quality = res === '1K' ? 'low' : res === '4K' ? 'high' : 'medium';
    return {
      taskApi: 'market',
      body: {
        model: hasImages ? 'gpt-image/1.5-image-to-image' : 'gpt-image/1.5-text-to-image',
        ...common,
        input: {
          prompt,
          aspect_ratio: ratio,
          quality,
          ...(hasImages ? { input_urls: imageUrls.slice(0, 16) } : {}),
        },
      },
      warnings: [],
    };
  }

  if (modelName === 'GPT Image 2') {
    const hasImages = imageUrls.length > 0;
    const model = hasImages
      ? (process.env.KIE_GPT_IMAGE_MODEL || 'gpt-image-2-image-to-image')
      : (process.env.KIE_GPT_TEXT_MODEL || 'gpt-image-2-text-to-image');
    const input = { prompt, aspect_ratio: ratio, resolution: res };
    if (hasImages) input.input_urls = imageUrls;
    return {
      taskApi: 'market',
      body: { model, ...common, input },
      warnings: [],
    };
  }

  if (['GPT Image 2.5 Flare', 'GPT Image 2.5 Sunburst'].includes(modelName)) {
    const hasImages = imageUrls.length > 0;
    const variant = modelName === 'GPT Image 2.5 Sunburst' ? 'sunburst' : 'flare';
    const mode = hasImages ? 'image-to-image' : 'text-to-image';
    const envName = `KIE_GPT_2_5_${variant.toUpperCase()}_${hasImages ? 'IMAGE' : 'TEXT'}_MODEL`;
    const outputRatio = new Set(['auto', '1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9']).has(ratio) ? ratio : 'auto';
    return {
      taskApi: 'market',
      body: {
        model: process.env[envName] || `gpt-image-2-5-${variant}-${mode}`,
        ...common,
        input: {
          prompt,
          aspect_ratio: outputRatio,
          resolution: res,
          background: 'opaque',
          ...(hasImages ? { input_urls: imageUrls.slice(0, 16) } : {}),
        },
      },
      warnings: outputRatio === ratio ? [] : [`GPT Image 2.5 不支持 ${ratio}，本次已改用自适应比例。`],
    };
  }

  if (modelName === 'Nano Banana') {
    const hasImages = imageUrls.length > 0;
    return {
      taskApi: 'market',
      body: {
        model: hasImages ? 'google/nano-banana-edit' : 'google/nano-banana',
        ...common,
        input: {
          prompt,
          output_format: 'png',
          aspect_ratio: ratio,
          ...(hasImages ? { image_urls: imageUrls } : {}),
        },
      },
      warnings: [],
    };
  }

  if (['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'].includes(modelName)) {
    const model = modelName === 'Nano Banana Pro'
      ? (process.env.KIE_NANO_PRO_MODEL || 'nano-banana-pro')
      : modelName === 'Nano Banana 2 Lite'
        ? (process.env.KIE_NANO2_LITE_MODEL || 'nano-banana-2-lite')
        : (process.env.KIE_NANO2_MODEL || 'nano-banana-2');
    const outputResolution = modelName === 'Nano Banana 2 Lite' ? '1K' : res;
    return {
      taskApi: 'market',
      body: {
        model,
        ...common,
        input: {
          prompt,
          image_input: imageUrls,
          aspect_ratio: ratio,
          resolution: outputResolution,
          output_format: 'png',
        },
      },
      warnings: modelName === 'Nano Banana 2 Lite' && res !== '1K' ? ['Nano Banana 2 Lite 仅支持 1K，本次已自动改用 1K。'] : [],
    };
  }

  if (['即梦 CLI 5.0 Pro', '即梦 CLI 5.0'].includes(modelName)) {
    const hasImages = imageUrls.length > 0;
    const tier = modelName === '即梦 CLI 5.0 Pro' ? 'pro' : 'lite';
    const mode = hasImages ? 'image-to-image' : 'text-to-image';
    const quality = res === '4K' ? 'ultra' : res === '2K' ? 'high' : 'basic';
    const outputRatio = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']).has(ratio) ? ratio : '1:1';
    return {
      taskApi: 'market',
      body: {
        model: `seedream/5-${tier}-${mode}`,
        ...common,
        input: {
          prompt,
          aspect_ratio: outputRatio,
          quality,
          output_format: 'png',
          nsfw_checker: true,
          ...(hasImages ? { image_urls: imageUrls.slice(0, tier === 'pro' ? 10 : 14) } : {}),
        },
      },
      warnings: outputRatio === ratio ? [] : [`即梦 5.0 不支持 ${ratio}，本次已改用 1:1。`],
    };
  }

  const err = new Error(`V1 暂未接入模型：${modelName}`);
  err.statusCode = 400;
  throw err;
}

async function createImageTask(options) {
  const { body, warnings, endpoint = '/api/v1/jobs/createTask', taskApi = 'market' } = buildTaskPayload(options);
  const json = await kieFetch(`${API_BASE()}${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const taskId = json?.data?.taskId;
  if (!taskId) {
    const err = new Error(json?.msg || 'Kie 未返回 taskId');
    err.payload = json;
    throw err;
  }
  return { taskId, model: body.model || 'gpt4o-image', taskApi, warnings };
}

function parseResultUrls(resultJson) {
  if (!resultJson) return [];
  let parsed = resultJson;
  if (typeof resultJson === 'string') {
    try { parsed = JSON.parse(resultJson); }
    catch { return []; }
  }
  const candidates = [
    parsed?.resultUrls,
    parsed?.urls,
    parsed?.images,
    parsed?.data?.resultUrls,
  ];
  for (const list of candidates) {
    if (Array.isArray(list)) {
      return list.map(x => typeof x === 'string' ? x : (x?.url || x?.imageUrl || x?.image_url)).filter(Boolean);
    }
  }
  return [];
}

async function getTask(taskId, taskApi = 'market') {
  if (taskApi === 'gpt4o') {
    const url = new URL(`${API_BASE()}/api/v1/gpt4o-image/record-info`);
    url.searchParams.set('taskId', taskId);
    const json = await kieFetch(url.toString(), { method: 'GET' });
    const data = json?.data || {};
    const status = String(data.status || '').toUpperCase();
    const successFlag = Number(data.successFlag);
    const response = data.response || {};
    const urls = response.resultUrls || response.result_urls || [];
    return {
      taskId: data.taskId || taskId,
      model: 'gpt4o-image',
      state: successFlag === 1 || status === 'SUCCESS' ? 'success' : successFlag === 2 || /FAILED/.test(status) ? 'fail' : 'generating',
      progress: Math.round(Number(data.progress || 0) * (Number(data.progress || 0) <= 1 ? 100 : 1)),
      resultUrls: Array.isArray(urls) ? urls : [],
      failCode: data.errorCode || '',
      failMsg: data.errorMessage || '',
      costTime: data.completeTime && data.createTime ? Number(data.completeTime) - Number(data.createTime) : 0,
      creditsConsumed: data.creditsConsumed ?? null,
      raw: data,
    };
  }
  const url = new URL(`${API_BASE()}/api/v1/jobs/recordInfo`);
  url.searchParams.set('taskId', taskId);
  const json = await kieFetch(url.toString(), { method: 'GET' });
  const data = json?.data || {};
  return {
    taskId: data.taskId || taskId,
    model: data.model || '',
    state: data.state || 'waiting',
    progress: Number(data.progress || 0),
    resultUrls: parseResultUrls(data.resultJson),
    failCode: data.failCode || '',
    failMsg: data.failMsg || '',
    costTime: Number(data.costTime || 0),
    creditsConsumed: data.creditsConsumed ?? null,
    raw: data,
  };
}

module.exports = {
  getCredits,
  prepareImageUrls,
  createImageTask,
  getTask,
  normalizeAspectRatio,
  normalizeResolution,
  buildTaskPayload,
};
