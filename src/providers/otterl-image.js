const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const platformSettings = require('../platform-settings');
const { generatedDir } = require('../storage-paths');

const tasks = new Map();
const GENERATED_DIR = generatedDir();
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
  'GPT Image 2': ['1K', '2K'],
  'GPT Image 2 · 4K 超分': ['4K'],
  'GPT Image 2 · 原生 4K': ['4K'],
  'GPT Image 2.5 Flare': ['1K', '2K'],
  'GPT Image 2.5 Sunburst': ['1K', '2K'],
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
  return Boolean(platformSettings.resolveModel(modelName));
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

function friendlyGenerationError(error, task) {
  const status = Number(error?.statusCode || 0);
  const native4k = task?.modelName === 'GPT Image 2 · 原生 4K';
  if (status === 451) {
    return '上游服务拒绝了该请求（HTTP 451），通常是参考图或提示词触发内容审核；请更换参考图或调整描述后重试';
  }
  if (status === 502 || status === 504 || /gateway\s*time-?out|upstream.*timed?\s*out/i.test(String(error?.message || ''))) {
    return native4k
      ? `原生 4K 上游在规定时间内未返回结果（HTTP ${status || 502}）；本次未成功交付，请稍后重试或改用“GPT Image 2 · 4K 超分”`
      : `上游图片服务暂时无响应（HTTP ${status || 502}），请稍后重试`;
  }
  const raw = String(error?.message || 'OtterL 图片生成失败').trim();
  if (/<\/?(?:html|head|body|title|center)\b/i.test(raw)) {
    return `上游图片服务返回了异常网页${status ? `（HTTP ${status}）` : ''}，请稍后重试`;
  }
  return raw.replace(/\s+/g, ' ').slice(0, 360);
}

function openAiImageOptions(aspectRatio, resolution) {
  const explicitRatio = aspectRatio !== 'auto';
  return {
    quality: resolution === '1K' ? 'medium' : 'high',
    resolution,
    image_size: resolution,
    // 不能同时发送固定 size（例如 1536x1024）和另一个 aspect_ratio。
    // OtterL 会优先采用 size，造成选择 21:9 却实际输出 3:2。
    ...(explicitRatio ? { aspect_ratio: aspectRatio } : { size: 'auto' }),
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

async function imageToBlob(source, task = null) {
  const value = String(source || '').trim();
  if (/^data:image\//i.test(value)) return dataUrlToBlob(value);
  if (!/^https?:\/\//i.test(value)) throw new Error('参考图地址无效');
  const headers = {};
  try {
    if (task?.referenceCookie && task?.referenceHost && new URL(value).host === task.referenceHost) {
      headers.Cookie = task.referenceCookie;
    }
  } catch {}
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(value, { headers, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }
      return new Blob([await response.arrayBuffer()], {
        type: response.headers.get('content-type') || 'image/png',
      });
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || (error?.statusCode && error.statusCode < 500)) break;
      await new Promise(resolve => setTimeout(resolve, 450));
    } finally {
      clearTimeout(timer);
    }
  }
  const reason = lastError?.name === 'AbortError' ? '请求超时' : (lastError?.message || '未知错误');
  throw new Error(`读取参考图失败：${reason}`);
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
  for (let index = 0; index < task.imageUrls.length; index += 1) {
    let blob;
    try { blob = await imageToBlob(task.imageUrls[index], task); }
    catch (error) { throw new Error(`第 ${index + 1} 张参考图无法读取：${error?.message || '未知错误'}`); }
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
    billingEligible: task.billingEligible !== false,
    resolution: task.resolution || '1K',
    aspectRatio: task.aspectRatio || 'auto',
    failCode: task.failCode || '',
    failMsg: task.failMsg || '',
    creditsConsumed: task.creditsConsumed ?? null,
    outputWidth: Number(task.outputWidth || 0),
    outputHeight: Number(task.outputHeight || 0),
    ratioAdjusted: Boolean(task.ratioAdjusted),
    createdAt: Number(task.createdAt || Date.now()),
    finishedAt: Number(task.finishedAt || 0),
  };
}

function persistTask(task) {
  fs.mkdirSync(TASK_DIR, { recursive: true });
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

function parsedAspectRatio(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function greatestCommonDivisor(a, b) {
  let left = Math.max(1, Math.round(a));
  let right = Math.max(1, Math.round(b));
  while (right) [left, right] = [right, left % right];
  return left;
}

function canonicalOutputSize(aspectRatio, resolution) {
  const parsed = parsedAspectRatio(aspectRatio);
  if (!parsed) return null;
  const gcd = greatestCommonDivisor(parsed.width, parsed.height);
  const ratioWidth = Math.round(parsed.width / gcd);
  const ratioHeight = Math.round(parsed.height / gcd);
  const longSide = resolution === '4K' ? 4096 : resolution === '2K' ? 2048 : 1024;
  const unit = Math.max(1, Math.floor(longSide / Math.max(ratioWidth, ratioHeight)));
  return { width: ratioWidth * unit, height: ratioHeight * unit };
}

function contentTypeFromFormat(format, fallback = 'image/png') {
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'avif') return 'image/avif';
  if (format === 'gif') return 'image/gif';
  if (format === 'png') return 'image/png';
  return fallback;
}

async function normalizeGeneratedImage(buffer, contentType, task) {
  const metadata = await sharp(buffer).metadata();
  const sourceWidth = Number(metadata.autoOrient?.width || metadata.width || 0);
  const sourceHeight = Number(metadata.autoOrient?.height || metadata.height || 0);
  let target = canonicalOutputSize(task?.aspectRatio, task?.resolution);
  if (!target && sourceWidth > 0 && sourceHeight > 0 && ['2K', '4K'].includes(task?.resolution)) {
    const longSide = task.resolution === '4K' ? 4096 : 2048;
    target = sourceWidth >= sourceHeight
      ? { width: longSide, height: Math.max(1, Math.round(longSide * sourceHeight / sourceWidth)) }
      : { width: Math.max(1, Math.round(longSide * sourceWidth / sourceHeight)), height: longSide };
  }
  if (!target) {
    task.outputWidth = sourceWidth;
    task.outputHeight = sourceHeight;
    return { buffer, contentType, adjusted: false };
  }
  const result = await sharp(buffer)
    .rotate()
    .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
    .toBuffer({ resolveWithObject: true });
  task.outputWidth = result.info.width;
  task.outputHeight = result.info.height;
  task.ratioAdjusted = sourceWidth !== target.width || sourceHeight !== target.height;
  return {
    buffer: result.data,
    contentType: contentTypeFromFormat(result.info.format, contentType),
    adjusted: task.ratioAdjusted,
  };
}

async function cacheResultUrls(taskId, urls, task = null) {
  const cached = [];
  for (let index = 0; index < urls.length; index += 1) {
    const rawSource = String(urls[index] || '').trim();
    if (rawSource.startsWith('/generated/')) {
      cached.push(rawSource);
      continue;
    }
    let source = rawSource;
    if (source && !/^data:/i.test(source)) {
      try { source = new URL(source, `${new URL(apiBase()).origin}/`).toString(); }
      catch { source = rawSource; }
    }
    let saved = false;
    let lastError = null;
    for (let attempt = 1; attempt <= 2 && !saved; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        let buffer;
        let contentType = 'image/png';
        const dataMatch = source.match(/^data:([^;,]+);base64,(.+)$/i);
        if (dataMatch) {
          contentType = dataMatch[1] || contentType;
          buffer = Buffer.from(dataMatch[2], 'base64');
        } else {
          const headers = { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 kai-image-cache/1.0' };
          try {
            if (new URL(source).origin === new URL(apiBase()).origin) headers.Authorization = `Bearer ${apiKey()}`;
          } catch {}
          const response = await fetch(source, { signal: controller.signal, redirect: 'follow', headers });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          contentType = response.headers.get('content-type') || contentType;
          buffer = Buffer.from(await response.arrayBuffer());
        }
        if (!buffer?.length) throw new Error('图片内容为空');
        if (task && (task.aspectRatio !== 'auto' || ['2K', '4K'].includes(task.resolution))) {
          const normalized = await normalizeGeneratedImage(buffer, contentType, task);
          buffer = normalized.buffer;
          contentType = normalized.contentType;
        }
        const digest = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
        const fileName = `${safeTaskId(taskId)}-${index + 1}-${digest}${extensionFromType(contentType)}`;
        fs.writeFileSync(path.join(GENERATED_DIR, fileName), buffer);
        cached.push(`/generated/${encodeURIComponent(fileName)}`);
        saved = true;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    // 下载仍失败时保留绝对临时地址给前端显示。上游已经成功生成并产生费用，
    // 后台仍会按成功任务结算；本地缓存失败只影响长期保存，不再造成客户免单。
    if (!saved && source) {
      console.warn('[otterl image cache]', taskId, `result ${index + 1}`, lastError?.message || '保存失败');
      cached.push(source);
    }
  }
  return cached.filter(Boolean);
}

function normalizeResultUrls(urls) {
  return (Array.isArray(urls) ? urls : []).map(raw => {
    const value = String(raw || '').trim();
    if (!value || /^data:/i.test(value) || value.startsWith('/generated/')) return value;
    try { return new URL(value, `${new URL(apiBase()).origin}/`).toString(); }
    catch { return value; }
  }).filter(Boolean);
}

function cacheTaskResultsInBackground(task) {
  // 上游已经生成完成时先允许浏览器拿到临时结果，不再让持久化下载阻塞画布。
  // 缓存成功后再切换为本地 /generated 地址；失败时保留临时地址并由前端确认交付。
  setImmediate(async () => {
    try {
      const cached = await cacheResultUrls(task.taskId, task.sourceResultUrls, task);
      if (!cached.length) return;
      task.resultUrls = cached;
      const locallySaved = cached.some(url => String(url).startsWith('/generated/') && hasLocalResult(url));
      if (locallySaved) {
        assertRequestedResolution(task);
        assertRequestedAspectRatio(task);
        task.billingEligible = true;
        task.failMsg = '';
      } else {
        task.billingEligible = true;
        task.failMsg = '图片已由上游成功生成，当前使用临时地址显示；本地缓存将在后台继续恢复';
      }
      persistTask(task);
    } catch (error) {
      task.billingEligible = true;
      task.failMsg = `图片已生成并可临时显示，但持久化缓存失败：${error?.message || '未知错误'}`;
      persistTask(task);
      console.warn('[otterl image background cache]', task.taskId, error?.message || error);
    }
  });
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
  if (!dimensions) throw new Error('生成图片已返回，但后台暂时无法读取真实像素；将由浏览器确认交付并结算');
  task.outputWidth = dimensions.width;
  task.outputHeight = dimensions.height;
  const longest = Math.max(dimensions.width, dimensions.height);
  const minimum = task.resolution === '4K' ? 3500 : task.resolution === '2K' ? 1800 : 700;
  if (longest < minimum) {
    throw new Error(`上游未按 ${task.resolution} 输出（实际 ${dimensions.width}×${dimensions.height}）；将保留图片并按成功交付结算`);
  }
}

function assertRequestedAspectRatio(task, dimensions = null) {
  const requested = String(task.aspectRatio || 'auto');
  if (requested === 'auto') return;
  const match = requested.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return;
  const measured = dimensions || task.resultUrls.map(localResultDimensions).find(Boolean);
  if (!measured?.width || !measured?.height) return;
  const expected = Number(match[1]) / Number(match[2]);
  const actual = measured.width / measured.height;
  const deviation = Math.abs(actual - expected) / expected;
  if (deviation > 0.025) {
    throw new Error(`上游未按 ${requested} 输出（实际 ${measured.width}×${measured.height}，比例约 ${actual.toFixed(3)}:1）；将保留图片并按成功交付结算`);
  }
}

async function runTask(task) {
  task.state = 'uploading';
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
      const requestBody = await geminiRequestBody(task);
      task.state = 'generating';
      task.progress = 22;
      persistTask(task);
      json = await otterGeminiFetch(task.model, requestBody);
      urls = extractGeminiResultUrls(json);
    } else if (task.imageUrls.length) {
      const form = new FormData();
      Object.entries(common).forEach(([key, value]) => form.append(key, String(value)));
      for (let index = 0; index < task.imageUrls.length; index += 1) {
        let blob;
        try { blob = await imageToBlob(task.imageUrls[index], task); }
        catch (error) { throw new Error(`第 ${index + 1} 张参考图无法读取：${error?.message || '未知错误'}`); }
        const ext = fileExtension(blob.type);
        form.append('image[]', blob, `reference-${index + 1}.${ext}`);
      }
      if (task.maskUrl) {
        const maskBlob = await imageToBlob(task.maskUrl, task);
        form.append('mask', maskBlob, `mask.${fileExtension(maskBlob.type)}`);
      }
      task.state = 'generating';
      task.progress = 22;
      persistTask(task);
      json = await otterFetch('/images/edits', { method: 'POST', body: form });
    } else {
      task.state = 'generating';
      task.progress = 22;
      persistTask(task);
      json = await otterFetch('/images/generations', {
        method: 'POST',
        body: JSON.stringify(common),
      });
    }
    if (!urls) urls = extractResultUrls(json);
    if (!urls.length) throw new Error('OtterL 返回成功，但没有可用的图片结果');
    task.sourceResultUrls = normalizeResultUrls(urls);
    task.resultUrls = task.sourceResultUrls.slice();
    // Explicit ratios are normalized before success is exposed to the browser. This
    // prevents a temporary upstream 3:2 image from appearing for a 9:16 request.
    const requiresVerifiedLocalOutput = task.aspectRatio !== 'auto' || ['2K', '4K'].includes(task.resolution);
    if (requiresVerifiedLocalOutput) {
      task.progress = 92;
      persistTask(task);
      const cached = await cacheResultUrls(task.taskId, task.sourceResultUrls, task);
      if (cached.some(url => String(url).startsWith('/generated/') && hasLocalResult(url))) {
        task.resultUrls = cached;
        assertRequestedResolution(task);
        assertRequestedAspectRatio(task);
      } else {
        task.failMsg = `图片已生成，但精确 ${task.aspectRatio} 比例的本地处理暂时失败；当前保留上游原图`;
      }
    }
    // 上游已经成功返回图片并产生费用，按成功任务结算。
    task.billingEligible = true;
    task.state = 'success';
    task.progress = 100;
    task.creditsConsumed = json?.usage?.total_tokens ?? json?.usageMetadata?.totalTokenCount ?? null;
    task.finishedAt = Date.now();
    persistTask(task);
    if (!requiresVerifiedLocalOutput) cacheTaskResultsInBackground(task);
  } catch (error) {
    task.state = 'fail';
    task.progress = 100;
    task.failCode = error?.name === 'AbortError' ? 'OTTERL_TIMEOUT' : 'OTTERL_GENERATION_FAILED';
    task.failMsg = error?.name === 'AbortError' ? 'OtterL 生成超时' : friendlyGenerationError(error, task);
  } finally {
    task.finishedAt = Date.now();
    persistTask(task);
  }
}

async function createImageTask({ modelName, prompt, aspectRatio, resolution, imageUrls = [], referenceHost = '', referenceCookie = '', maskUrl = '', background = '', operation = '' }) {
  const runtimeModel = platformSettings.resolveModel(modelName);
  const requestedResolution = runtimeModel?.fixedResolution || (FIXED_4K_MODELS.has(modelName) ? '4K' : normalizeResolution(resolution));
  const supportedResolutions = runtimeModel?.resolutions || MODEL_RESOLUTIONS[modelName] || ['1K'];
  const normalizedResolution = supportedResolutions.includes(requestedResolution) ? requestedResolution : supportedResolutions[0];
  const model = runtimeModel?.id || MODEL_IDS[modelName];
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
    // Used only in memory while downloading this account's own protected reference
    // images. publicTask() deliberately never persists or returns the session cookie.
    referenceHost: String(referenceHost || ''),
    referenceCookie: String(referenceCookie || ''),
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
    billingEligible: true,
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
      task.resultUrls = await cacheResultUrls(taskId, recoveryUrls, task);
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
    billingEligible: task.billingEligible !== false,
    resolution: task.resolution || '1K',
    aspectRatio: task.aspectRatio || 'auto',
    outputWidth: Number(task.outputWidth || 0),
    outputHeight: Number(task.outputHeight || 0),
    ratioAdjusted: Boolean(task.ratioAdjusted),
  };
}

// The HTTP delivery route uses the same normalizer as the background cache. This
// guarantees the selected ratio even when saving the upstream temporary URL to
// Railway storage failed and the route must proxy the original image directly.
module.exports = { configured, supportsModel, createImageTask, getTask, getPublicPricing, normalizeDeliveryImage: normalizeGeneratedImage };
