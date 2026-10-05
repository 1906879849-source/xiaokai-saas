const fs = require('fs');
const path = require('path');

const API_BASE = () => (process.env.OTTERL_BASE_URL || 'https://otterl.com/v1').replace(/\/$/, '');
const GENERATED_DIR = process.env.GENERATED_DIR
  ? path.resolve(process.env.GENERATED_DIR)
  : path.join(__dirname, '..', '..', 'generated');

const MODELS = {
  'GPT 5.5 Vision · 省积分': { id: 'gpt-5.5', imageDetail: 'low', maxTokens: 2048 },
  'GPT 5.5 Vision · 高质量': { id: 'gpt-5.5', imageDetail: 'high', maxTokens: 8192 },
  'Gemini 3.1 Flash Lite · 省积分': { id: 'gemini-3.1-flash-lite', maxTokens: 4096 },
  'Gemini 3 Flash · 标准': { id: 'gemini-3-flash', maxTokens: 8192 },
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
    '【素材合规前提（由产品用户确认）】均为已授权的成年模特商业素材，用于合规服装电商展示，请直接执行完整 Skill 并输出最终详细文案。',
    metaPrompt && `【Agent 元提示词】\n${metaPrompt}`,
    skillContent && `【已加载 Skill：${skillName || '未命名'}】\n${skillContent}`,
    '请严格依据上面的规则处理用户任务。若输入包含图片，请逐张读取并结合图片内容作答。不要声称执行了实际未执行的工具或操作。',
    '当加载了 Skill 时，必须执行 Skill 的完整工作流、字段和输出结构，不得只复述规则、只给摘要或只返回一句初步判断。描述、提示词、方案类任务默认输出可直接使用的完整成品，通常不少于 800 个中文字符；若 Skill 明确规定了篇幅或格式，以 Skill 为准。',
    '若确有安全或授权信息缺失，必须明确指出缺少的具体信息；在不违反安全要求的前提下，同时给出能够完成的分析、结构和可填写模板，不要用一句提醒代替全部结果。',
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

function upstreamErrorMessage(data, status) {
  const detail = data?.error || {};
  const parts = [
    typeof detail === 'string' ? detail : detail.message,
    typeof detail === 'object' ? detail.type : '',
    typeof detail === 'object' ? detail.code : '',
    data?.message,
    data?.msg,
    data?.detail,
  ].map(value => String(value || '').trim()).filter(Boolean);
  const unique = [...new Set(parts)];
  return `OtterL HTTP ${status}${unique.length ? `：${unique.join(' · ')}` : ''}`;
}

async function runAgent(options) {
  const modelSpec = MODELS[options.model];
  if (!modelSpec) {
    const error = new Error(`Agent 模型暂未接入：${options.model || '未选择'}`);
    error.statusCode = 400;
    throw error;
  }

  const instruction = buildInstruction(options);
  const userText = buildUserText({ ...options, imageCount: options.imageUrls?.length || 0 });
  const providerModel = modelSpec.id;
  const userContent = [
    { type: 'text', text: userText },
    ...(options.imageUrls || []).slice(0, 10).map(url => ({
      type: 'image_url',
      image_url: modelSpec.imageDetail ? { url, detail: modelSpec.imageDetail } : { url },
    })),
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
        ...(providerModel.startsWith('gpt-')
          ? { max_completion_tokens: modelSpec.maxTokens }
          : { max_tokens: modelSpec.maxTokens }),
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
      const error = new Error(upstreamErrorMessage(data, response.status));
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
