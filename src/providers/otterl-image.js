const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const tasks = new Map();
const GENERATED_DIR = process.env.GENERATED_DIR ? path.resolve(process.env.GENERATED_DIR) : path.join(__dirname, '..', '..', 'generated');
const TASK_DATA_ROOT = process.env.IMAGE_TASK_DATA_DIR
  || process.env.WALLET_DATA_DIR
  || process.env.ACCOUNT_DATA_DIR
  || process.env.DATA_DIR
  || path.dirname(GENERATED_DIR);
const TASK_DIR = path.join(path.resolve(TASK_DATA_ROOT), 'image-tasks');
fs.mkdirSync(GENERATED_DIR, { recursive: true });
fs.mkdirSync(TASK_DIR, { recursive: true });

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
const GEMINI_IMAGE_MODELS = new Set(['Gemini 3 Pro Image', 'Gemini 3.1 Flash Image']);
const MODEL_RESOLUTIONS = {
  'GPT Image 2': ['1K'],
  'GPT Image 2 · 4K 超分': ['4K'],
  'GPT Image 2 · 原生 4K': ['4K'],
  'GPT Image 2.5 Flare': ['1K'],
  'GPT Image 2.5 Sunburst': ['1K'],
  'Gemini 3 Pro Image': ['1K', '2K', '4K'],
  'Gemini 3.1 Flash Image': ['1K', '2K', '4K'],
};

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
  const resolution = String(value || '').trim().toLowerCase();
  if (resolution === '4k') return '4K';
  if (resolution === '2k' || resolution === 'high' || resolution === '高质量') return '2K';
  return '1K';
}

function normalizeBackground(value) {
  return /透明|transparent/i.test(String(value || '')) ? 'transparent' : 'auto';
}

function openAiImageOptions(aspectRatio, resolution) {
  const portrait = new Set(['9:16', '3:4', '2:3', '4:5']);
  const landscape = new Set(['16:9', '4:3', '3:2', '5:4', '21:9']);
  const size = portrait.has(aspectRatio)
    ? '1024x1536'
    : landscape.has(aspectRatio)
      ? '1536x1024'
      : '1024x1024';
  return {
    size,
    quality: resolution === '1K' ? 'medium' : 'high',
    resolution,
    image_size: resolution,
    ...(aspectRatio !== 'auto' ? { aspect_ratio: aspectRatio } : {}),
  };
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

async function otterGeminiFetch(model, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000);
  try {
    const origin = new URL(apiBase()).origin;
    const response = await fetch(`${origin}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; }
    catch { json = { error: { message: text || `HTTP ${response.status}` } }; }
    if (!response.ok) {
      const message = json?.error?.message || json?.message || json?.msg || `OtterL Gemini HTTP ${response.status}`;
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

function extractGeminiResultUrls(json) {
  const parts = Array.isArray(json?.candidates?.[0]?.content?.parts) ? json.candidates[0].content.parts : [];
  return parts.map(part => {
    const inline = part?.inlineData || part?.inline_data;
    const data = inline?.data;
    const mimeType = inline?.mimeType || inline?.mime_type || 'image/png';
    return data && !part?.thought ? `data:${mimeType};base64,${data}` : '';
  }).filter(Boolean);
}

async function geminiRequestBody(task) {
  const parts = [{ text: task.prompt }];
  for (const source of task.imageUrls) {
    const blob = await imageToBlob(source);
    parts.push({
      inlineData: {
        mimeType: blob.type || 'image/png',
        data: Buffer.from(await blob.arrayBuffer()).toString('base64'),
      },
    });
  }
  const imageConfig = { imageSize: task.resolution };
  if (task.aspectRatio !== 'auto') imageConfig.aspectRatio = task.aspectRatio;
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig,
    },
  };
}

function safeTaskId(taskId) {
  return String(taskId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function taskFile(taskId) {
  return path.join(TASK_DIR, `${safeTaskId(taskId)}.json`);
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    modelName: task.modelName || '',
    model: task.model,
    state: task.state,
    progress: task.progress,
    resultUrls: Array.isArray(task.resultUrls) ? task.resultUrls : [],
    sourceResultUrls: Array.isArray(task.sourceResultUrls) ? task.sourceResultUrls.filter(url => /^https?:\/\//i.test(String(url))) : [],
    failCode: task.failCode || '',
    failMsg: task.failMsg || '',
    creditsConsumed: task.creditsConsumed ?? null,
    outputWidth: Number(task.outputWidth || 0),
    outputHeight: Number(task.outputHeight || 0),
    createdAt: Number(task.createdAt || Date.now()),
    finishedAt: Number(task.finishedAt || 0),
  };
}

function persistTask(task) {
  const file = taskFile(task.taskId);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(publicTask(task), null, 2));
  fs.renameSync(temp, file);
}

function loadPersistedTask(taskId) {
  const file = taskFile(taskId);
  if (!fs.existsSync(file)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved?.taskId !== taskId) return null;
    return saved;
  } catch {
    return null;
  }
}

function extensionFromType(type = '') {
  if (/jpe?g/i.test(type)) return '.jpg';
  if (/webp/i.test(type)) return '.webp';
  if (/gif/i.test(type)) return '.gif';
  return '.png';
}

async function cacheResultUrls(taskId, urls) {
  const cached = [];
  for (let index = 0; index < urls.length; index += 1) {
    const source = String(urls[index] || '');
    if (source.startsWith('/generated/')) {
      cached.push(source);
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let buffer;
      let contentType = 'image/png';
      const dataMatch = source.match(/^data:([^;,]+);base64,(.+)$/i);
      if (dataMatch) {
        contentType = dataMatch[1] || contentType;
        buffer = Buffer.from(dataMatch[2], 'base64');
      } else {
        const response = await fetch(source, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        contentType = response.headers.get('content-type') || contentType;
        buffer = Buffer.from(await response.arrayBuffer());
      }
      if (!buffer?.length) throw new Error('图片内容为空');
      const digest = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
      const fileName = `${safeTaskId(taskId)}-${index + 1}-${digest}${extensionFromType(contentType)}`;
      fs.writeFileSync(path.join(GENERATED_DIR, fileName), buffer);
      cached.push(`/generated/${encodeURIComponent(fileName)}`);
    } catch (error) {
      // 缓存失败时保留原地址；任务记录仍会落盘，后续“找回结果”可以再次尝试缓存。
      cached.push(source);
    } finally {
      clearTimeout(timeout);
    }
  }
  return cached.filter(Boolean);
}

function hasLocalResult(url) {
  const prefix = '/generated/';
  const value = String(url || '');
  if (!value.startsWith(prefix)) return true;
  const fileName = path.basename(decodeURIComponent(value.slice(prefix.length)));
  return fs.existsSync(path.join(GENERATED_DIR, fileName));
}

function imageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

function localResultDimensions(url) {
  const prefix = '/generated/';
  const value = String(url || '');
  if (!value.startsWith(prefix)) return null;
  const fileName = path.basename(decodeURIComponent(value.slice(prefix.length)));
  const file = path.join(GENERATED_DIR, fileName);
  return fs.existsSync(file) ? imageDimensions(fs.readFileSync(file)) : null;
}

function assertRequestedResolution(task) {
  const dimensions = task.resultUrls.map(localResultDimensions).find(Boolean);
  if (!dimensions) throw new Error('生成图片已返回，但无法读取真实像素；本次客户积分不会扣除');
  task.outputWidth = dimensions.width;
  task.outputHeight = dimensions.height;
  const longest = Math.max(dimensions.width, dimensions.height);
  const minimum = task.resolution === '4K' ? 3500 : task.resolution === '2K' ? 1800 : 700;
  if (longest < minimum) {
    throw new Error(`上游未按 ${task.resolution} 输出（实际 ${dimensions.width}×${dimensions.height}）；本次客户积分不会扣除`);
  }
}

async function runTask(task) {
  task.state = 'generating';
  task.progress = 8;
  persistTask(task);
  try {
    const common = {
      model: task.model,
      prompt: task.prompt,
      n: 1,
      response_format: 'url',
      ...openAiImageOptions(task.aspectRatio, task.resolution),
    };
    if (task.background === 'transparent') common.background = 'transparent';
    let json;
    let urls;
    if (GEMINI_IMAGE_MODELS.has(task.modelName)) {
      task.progress = 18;
      json = await otterGeminiFetch(task.model, await geminiRequestBody(task));
      urls = extractGeminiResultUrls(json);
    } else if (task.imageUrls.length) {
      const form = new FormData();
      Object.entries(common).forEach(([key, value]) => form.append(key, String(value)));
      for (let index = 0; index < task.imageUrls.length; index += 1) {
        const blob = await imageToBlob(task.imageUrls[index]);
        const ext = fileExtension(blob.type);
        form.append('image[]', blob, `reference-${index + 1}.${ext}`);
      }
      if (task.maskUrl) {
        const maskBlob = await imageToBlob(task.maskUrl);
        form.append('mask', maskBlob, `mask.${fileExtension(maskBlob.type)}`);
      }
      task.progress = 18;
      json = await otterFetch('/images/edits', { method: 'POST', body: form });
    } else {
      json = await otterFetch('/images/generations', {
        method: 'POST',
        body: JSON.stringify(common),
      });
    }
    if (!urls) urls = extractResultUrls(json);
    if (!urls.length) throw new Error('OtterL 返回成功，但没有可用的图片结果');
    task.sourceResultUrls = urls;
    task.resultUrls = await cacheResultUrls(task.taskId, urls);
    const locallySaved = task.resultUrls.some(url => String(url).startsWith('/generated/') && hasLocalResult(url));
    if (!locallySaved) {
      throw new Error('上游已生成图片，但结果保存失败；本次客户积分不会扣除，请稍后重试');
    }
    assertRequestedResolution(task);
    task.state = 'success';
    task.progress = 100;
    task.creditsConsumed = json?.usage?.total_tokens ?? json?.usageMetadata?.totalTokenCount ?? null;
  } catch (error) {
    task.state = 'fail';
    task.progress = 100;
    task.failCode = error?.name === 'AbortError' ? 'OTTERL_TIMEOUT' : 'OTTERL_GENERATION_FAILED';
    task.failMsg = error?.name === 'AbortError' ? 'OtterL 生成超时' : (error?.message || 'OtterL 图片生成失败');
  } finally {
    task.finishedAt = Date.now();
    persistTask(task);
  }
}

async function createImageTask({ modelName, prompt, aspectRatio, resolution, imageUrls = [], maskUrl = '', background = '', operation = '' }) {
  const requestedResolution = FIXED_4K_MODELS.has(modelName) ? '4K' : normalizeResolution(resolution);
  const supportedResolutions = MODEL_RESOLUTIONS[modelName] || ['1K'];
  const normalizedResolution = supportedResolutions.includes(requestedResolution) ? requestedResolution : supportedResolutions[0];
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
    modelName,
    model,
    prompt: String(prompt || '').trim(),
    aspectRatio: normalizeAspectRatio(aspectRatio),
    resolution: normalizedResolution,
    imageUrls: Array.isArray(imageUrls) ? imageUrls.slice(0, 10) : [],
    maskUrl: String(maskUrl || ''),
    background: normalizeBackground(background),
    operation: String(operation || ''),
    state: 'waiting',
    progress: 2,
    resultUrls: [],
    sourceResultUrls: [],
    failCode: '',
    failMsg: '',
    creditsConsumed: null,
    outputWidth: 0,
    outputHeight: 0,
    createdAt: Date.now(),
    finishedAt: 0,
  };
  tasks.set(taskId, task);
  persistTask(task);
  setImmediate(() => runTask(task));
  const warnings = normalizedResolution === requestedResolution
    ? []
    : [`${modelName} 不支持 ${requestedResolution}，本次已自动改用 ${normalizedResolution}。`];
  return { taskId, model, taskApi: 'otterl', warnings };
}

async function getTask(taskId) {
  let task = tasks.get(taskId);
  if (!task) {
    task = loadPersistedTask(taskId);
    if (task?.state === 'success' && task.resultUrls?.length) {
      const missingLocalResult = task.resultUrls.some(url => !hasLocalResult(url));
      const recoveryUrls = missingLocalResult && task.sourceResultUrls?.length ? task.sourceResultUrls : task.resultUrls;
      task.resultUrls = await cacheResultUrls(taskId, recoveryUrls);
      persistTask(task);
    }
  }
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
    outputWidth: Number(task.outputWidth || 0),
    outputHeight: Number(task.outputHeight || 0),
  };
}

module.exports = { configured, supportsModel, createImageTask, getTask, getPublicPricing };
