const fs = require('fs');
const path = require('path');
const { generatedDir } = require('../storage-paths');

const GENERATED_DIR = generatedDir();
const MODELS = {
  'GPT 5.5': { id: 'gpt-5.5', maxTokens: 8192 },
  'GPT 5.6 Luna': { id: 'gpt-5.6-luna', maxTokens: 8192 },
  'Gemini 3.5 Flash': { id: 'gemini-3.5-flash', maxTokens: 8192 },
  'Gemini 3.1 Pro Preview': { id: 'gemini-3.1-pro-preview', maxTokens: 8192 },
};

function apiBase() { return String(process.env.RIVO_BASE_URL || 'https://api.rivoapi.com/v1').trim().replace(/\/$/, ''); }
function apiKey() {
  const key = String(process.env.RIVO_API_KEY || '').trim();
  if (!key) throw Object.assign(new Error('RIVO_API_KEY 未配置。请在 Railway Variables 中填写，不要上传到代码仓库。'), { statusCode: 503 });
  return key;
}
function configured() { return Boolean(String(process.env.RIVO_API_KEY || '').trim()); }
function listModels() { return Object.keys(MODELS); }

function localImageDataUrl(source) {
  const match = String(source || '').match(/^\/generated\/([^?#]+)/i);
  if (!match) return '';
  const file = path.join(GENERATED_DIR, path.basename(decodeURIComponent(match[1])));
  if (!fs.existsSync(file)) return '';
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png';
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
  const contexts = (contextTexts || []).map(item => typeof item === 'string' ? item : `[${item?.label || '上游文字'}]\n${item?.value || ''}`).filter(Boolean);
  return [
    userNeed || '请按照已加载的 Skill 分析上游内容，并输出可直接使用的完整结果。',
    contexts.length ? `【上游文字变量】\n${contexts.join('\n\n')}` : '',
    imageCount ? `【上游图片】共 ${imageCount} 张，请逐张读取并结合任务处理。` : '',
  ].filter(Boolean).join('\n\n');
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(item => item?.text || item?.content || '').filter(Boolean).join('\n').trim();
  return '';
}

function upstreamErrorMessage(data, status) {
  const detail = data?.error || {};
  const parts = [typeof detail === 'string' ? detail : detail.message, detail?.type, detail?.code, data?.message, data?.msg]
    .map(value => String(value || '').trim()).filter(Boolean);
  return `Rivo HTTP ${status}${parts.length ? `：${[...new Set(parts)].join(' · ')}` : ''}`;
}

async function runAgent(options) {
  const modelSpec = MODELS[options.model];
  if (!modelSpec) throw Object.assign(new Error(`Agent 模型暂未接入：${options.model || '未选择'}`), { statusCode: 400 });
  const instruction = buildInstruction(options);
  const userText = buildUserText({ ...options, imageCount: options.imageUrls?.length || 0 });
  const userContent = [
    { type: 'text', text: userText },
    ...(options.imageUrls || []).slice(0, 10).map(url => ({ type: 'image_url', image_url: { url } })),
  ];
  const controller = new AbortController();
  const configuredTimeout = Number(process.env.AGENT_PROVIDER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(60_000, Math.min(30 * 60_000, configuredTimeout)) : 12 * 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let data;
  try {
    const response = await fetch(`${apiBase()}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSpec.id, stream: false,
        ...(modelSpec.id.startsWith('gpt-') ? { max_completion_tokens: modelSpec.maxTokens } : { max_tokens: modelSpec.maxTokens }),
        messages: [{ role: 'system', content: instruction }, { role: 'user', content: userContent }],
      }),
    });
    const raw = await response.text();
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: { message: raw || `HTTP ${response.status}` } }; }
    if (!response.ok) throw Object.assign(new Error(upstreamErrorMessage(data, response.status)), { statusCode: response.status, payload: data });
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Agent 上游处理超时，冻结积分已返还，请减少参考图后重试'), { statusCode: 504 });
    throw error;
  } finally { clearTimeout(timeout); }

  const text = extractText(data);
  if (!text) throw Object.assign(new Error('模型调用成功，但没有返回可显示的文字内容'), { payload: data });
  const rawUsage = data?.usage || {};
  const inputText = `${instruction}\n\n${userText}`;
  const usage = Object.keys(rawUsage).length ? rawUsage : {
    input_tokens: Math.max(1, Math.ceil(inputText.length / 3)),
    output_tokens: Math.max(1, Math.ceil(text.length / 3)),
    estimated: true,
  };
  return { text, usage, providerModel: modelSpec.id, providerCredits: data?.credits_consumed ?? null };
}

module.exports = { MODELS, configured, listModels, prepareImageUrls, runAgent };
