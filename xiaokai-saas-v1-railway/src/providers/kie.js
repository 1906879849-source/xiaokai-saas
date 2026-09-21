const { resolveModel } = require('../model-router');

const API_BASE = () => (process.env.KIE_API_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '');
const UPLOAD_BASE = () => (process.env.KIE_UPLOAD_BASE_URL || 'https://kieai.redpandaai.co').replace(/\/$/, '');

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

async function prepareImageUrls(images = []) {
  const out = [];
  let index = 0;
  for (const image of images) {
    index += 1;
    if (typeof image !== 'string' || !image.trim()) continue;
    const src = image.trim();
    if (/^data:image\//i.test(src)) {
      out.push(await uploadBase64(src, `xiaokai-input-${Date.now()}-${index}.png`));
    } else if (/^https?:\/\//i.test(src)) {
      out.push(src);
    }
  }
  return out;
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

function textImageModelEnvKey(base) {
  return {
    'gpt-image-1.5': { text: 'KIE_GPT15_TEXT_MODEL', image: 'KIE_GPT15_IMAGE_MODEL' },
    'gpt-image-2': { text: 'KIE_GPT2_TEXT_MODEL', image: 'KIE_GPT2_IMAGE_MODEL' },
    'gpt-image-all': { text: 'KIE_GPTALL_TEXT_MODEL', image: 'KIE_GPTALL_IMAGE_MODEL' },
    '4o-image': { text: 'KIE_4O_IMAGE_TEXT_MODEL', image: 'KIE_4O_IMAGE_IMAGE_MODEL' },
  }[base] || null;
}

function textImageModelDefaults(base) {
  return {
    'gpt-image-1.5': { text: 'gpt-image-1.5-text-to-image', image: 'gpt-image-1.5-image-to-image' },
    'gpt-image-2': { text: 'gpt-image-2-text-to-image', image: 'gpt-image-2-image-to-image' },
    'gpt-image-all': { text: 'gpt-image-2-text-to-image', image: 'gpt-image-2-image-to-image' },
    '4o-image': { text: '4o-image', image: '4o-image' },
  }[base] || { text: base, image: base };
}

function pickEnv(...keys) {
  for (const key of keys) {
    const value = key ? String(process.env[key] || '').trim() : '';
    if (value) return value;
  }
  return '';
}

function resolveProviderModel(modelName, hasImages) {
  const meta = resolveModel(modelName);
  if (!meta) {
    const err = new Error(`V1 暂未接入模型：${modelName}`);
    err.statusCode = 400;
    throw err;
  }

  if (meta.family === 'gpt-image') {
    const envKeys = textImageModelEnvKey(meta.id);
    const defaults = textImageModelDefaults(meta.id);
    return hasImages
      ? (pickEnv(envKeys?.image, 'KIE_GPT_IMAGE_MODEL') || defaults.image)
      : (pickEnv(envKeys?.text, 'KIE_GPT_TEXT_MODEL') || defaults.text);
  }

  if (meta.family === 'nano-banana') {
    const mapping = {
      'google/nano-banana': 'KIE_NANO_MODEL',
      'nano-banana-pro': 'KIE_NANO_PRO_MODEL',
      'nano-banana-2': 'KIE_NANO2_MODEL',
      'nano-banana-2-lite': 'KIE_NANO2_LITE_MODEL',
    };
    return pickEnv(mapping[meta.id]) || meta.id;
  }

  return meta.id;
}

function buildTaskPayload({ modelName, prompt, aspectRatio, resolution, background, imageUrls = [], callbackUrl = '' }) {
  const ratio = normalizeAspectRatio(aspectRatio);
  const res = normalizeResolution(resolution);
  const common = callbackUrl ? { callBackUrl: callbackUrl } : {};
  const modelMeta = resolveModel(modelName);
  if (!modelMeta) {
    const err = new Error(`V1 暂未接入模型：${modelName}`);
    err.statusCode = 400;
    throw err;
  }

  const hasImages = imageUrls.length > 0;
  const providerModel = resolveProviderModel(modelName, hasImages);
  const warnings = [];

  if (modelMeta.family === 'gpt-image') {
    const input = { prompt, aspect_ratio: ratio };
    if (hasImages) input.input_urls = imageUrls;
    if (String(background || '').includes('透明')) input.transparent_background = true;
    warnings.push(`${modelName} 当前按 GPT 图像接口发送；分辨率档位会由服务端自动处理，不强制透传 1K/2K/4K。`);
    return {
      body: { model: providerModel, ...common, input },
      warnings,
    };
  }

  if (modelMeta.family === 'nano-banana') {
    const input = {
      prompt,
      image_input: imageUrls,
      aspect_ratio: ratio,
      resolution: res,
      output_format: 'png',
    };
    if (String(background || '').includes('透明')) input.transparent_background = true;
    return {
      body: {
        model: providerModel,
        ...common,
        input,
      },
      warnings,
    };
  }

  const err = new Error(`V1 暂未接入模型：${modelName}`);
  err.statusCode = 400;
  throw err;
}

async function createImageTask(options) {
  const { body, warnings } = buildTaskPayload(options);
  const json = await kieFetch(`${API_BASE()}/api/v1/jobs/createTask`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const taskId = json?.data?.taskId;
  if (!taskId) {
    const err = new Error(json?.msg || 'Kie 未返回 taskId');
    err.payload = json;
    throw err;
  }
  return { taskId, model: body.model, warnings };
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

async function getTask(taskId) {
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
};
