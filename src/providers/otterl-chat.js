const fs = require('fs');
const path = require('path');

const API_BASE = () => (process.env.OTTERL_BASE_URL || 'https://otterl.com/v1').replace(/\/$/, '');
const GENERATED_DIR = process.env.GENERATED_DIR
  ? path.resolve(process.env.GENERATED_DIR)
  : path.join(__dirname, '..', '..', 'generated');

const MODELS = {
  'GPT 5.5 Compact · Instant': 'gpt-5.5-openai-compact',
  'GPT 5.5 · Thinking': 'gpt-5.5',
  'GPT 5.6 SOL · Pro': 'gpt-5.6-sol',
  'Gemini 3.1 Flash Lite': 'gemini-3.1-flash-lite',
  'Gemini 3 Flash Thinking': 'gemini-3-flash-thinking-128',
  'Gemini 3.1 Pro High': 'gemini-3.1-pro-high',
};

function apiKey() {
  const key = String(process.env.OTTERL_API_KEY || '').trim();
  if (!key) {
    const error = new Error('OTTERL_API_KEY 未配置。请先在本机 .env 中填写。');
    error.statusCode = 503;
    throw error;
  }
  return key;
}

function listModels() {
  return Object.keys(MODELS);
}

function localImageDataUrl(source) {
  const match = String(source || '').match(/^\/generated\/([^?#]+)/i);
  if (!match) return '';
  const name = path.basename(decodeURIComponent(match[1]));
  const file = path.join(GENERATED_DIR, name);
  if (!fs.existsSync(file)) return '';
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

async function prepareImageUrls(images = []) {
  return images.map(value => {
    const source = String(value || '').trim();
    if (/^data:image\//i.test(source) || /^https?:\/\//i.test(source)) return source;
    return localImageDataUrl(source);
  }).filter(Boolean).slice(0, 10);
}

function buildInstruction({ metaPrompt, skillName, skillContent }) {
  return [
    metaPrompt && `【Agent 元提示词】\n${metaPrompt}`,
    skillContent && `【已加载 Skill：${skillName || '未命名'}】\n${skillContent}`,
    '请严格依据上面的规则处理用户任务。若输入包含图片，请结合图片内容作答。不要声称执行了实际未执行的工具或操作。',
  ].filter(Boolean).join('\n\n');
}

function buildUserText({ userNeed, contextTexts, imageCount }) {
  const contexts = (contextTexts || []).map(item => {
    if (typeof item === 'string') return item;
    return `[${item?.label || '上游文字'}]\n${item?.value || ''}`;
  }).filter(Boolean);
  return [
    userNeed || '请按照已加载的 Skill 分析上游内容，并输出可直接使用的完整结果。',
    contexts.length ? `【上游文字变量】\n${contexts.join('\n\n')}` : '',
    imageCount ? `【上游图片】共 ${imageCount} 张，请逐张读取并结合任务处理。` : '',
  ].filter(Boolean).join('\n\n');
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(item => item?.text || item?.content || '').filter(Boolean).join('\n').trim();
  }
  return '';
}

async function runAgent(options) {
  const providerModel = MODELS[options.model];
  if (!providerModel) {
    const error = new Error(`Agent 模型暂未接入：${options.model || '未选择'}`);
    error.statusCode = 400;
    throw error;
  }

  const instruction = buildInstruction(options);
  const userText = buildUserText({ ...options, imageCount: options.imageUrls?.length || 0 });
  const userContent = [
    { type: 'text', text: userText },
    ...(options.imageUrls || []).slice(0, 10).map(url => ({ type: 'image_url', image_url: { url } })),
  ];
  const controller = new AbortController();
  // Agent 携带多张参考图和较长 Skill 时，上游可能需要数分钟。
  // 这里允许后台继续完成；浏览器端通过任务状态轮询，不再占着一次长 HTTP 请求。
  const configuredTimeout = Number(process.env.AGENT_PROVIDER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.max(60_000, Math.min(30 * 60_000, configuredTimeout))
    : 12 * 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let data;
  try {
    const response = await fetch(`${API_BASE()}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: providerModel,
        stream: false,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: userContent },
        ],
      }),
    });
    const raw = await response.text();
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { data = { error: { message: raw || `HTTP ${response.status}` } }; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || `OtterL HTTP ${response.status}`);
      error.statusCode = response.status;
      error.payload = data;
      throw error;
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Agent 上游处理超时，冻结积分已返还，请减少参考图后重试');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = extractText(data);
  if (!text) {
    const error = new Error('模型调用成功，但没有返回可显示的文字内容');
    error.payload = data;
    throw error;
  }
  const rawUsage = data?.usage || {};
  const inputText = `${instruction}\n\n${userText}`;
  const usage = {
    input_tokens: Number(rawUsage.input_tokens ?? rawUsage.prompt_tokens) || Math.max(1, Math.ceil(inputText.length / 3)),
    output_tokens: Number(rawUsage.output_tokens ?? rawUsage.completion_tokens) || Math.max(1, Math.ceil(text.length / 3)),
    provider_usage: Object.keys(rawUsage).length ? rawUsage : null,
    estimated: !Object.keys(rawUsage).length,
  };
  return { text, usage, providerModel, providerCredits: data?.credits_consumed ?? null };
}

module.exports = { MODELS, listModels, prepareImageUrls, runAgent };
