const API_BASE = () => (process.env.KIE_API_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '');

function apiKey() {
  const key = (process.env.KIE_API_KEY || '').trim();
  if (!key) {
    const error = new Error('KIE_API_KEY 未配置，请先运行“配置密钥.bat”填写密钥。');
    error.statusCode = 503;
    throw error;
  }
  return key;
}

async function request(path, body, timeoutMs = 180000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE()}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { data = { message: raw || `HTTP ${response.status}` }; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.msg || data?.message || `Kie HTTP ${response.status}`);
      error.statusCode = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

const MODELS = {
  'Gemini 3 Pro': { kind: 'chat', path: '/gemini-3-pro/v1/chat/completions' },
  'Gemini 3.6 Flash': { kind: 'chat', path: '/gemini-3-6-flash-openai/v1/chat/completions' },
  'GPT 5.4': { kind: 'responses', path: '/codex/v1/responses', model: 'gpt-5-4' },
  'GPT 5.2': { kind: 'chat', path: '/gpt-5-2/v1/chat/completions' },
  'Claude 4.6': { kind: 'claude', path: '/claude/v1/messages', model: 'claude-opus-4-6' },
};

function listModels() {
  return Object.keys(MODELS);
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

function extractChatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(x => x?.text || x?.content || '').filter(Boolean).join('\n').trim();
  return '';
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  const blocks = Array.isArray(data?.output) ? data.output : [];
  return blocks.flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .map(item => item?.text || item?.output_text || '').filter(Boolean).join('\n').trim();
}

function extractClaudeText(data) {
  return (Array.isArray(data?.content) ? data.content : [])
    .map(item => item?.type === 'text' ? item.text : '').filter(Boolean).join('\n').trim();
}

async function runAgent(options) {
  const spec = MODELS[options.model];
  if (!spec) {
    const error = new Error(`Agent 模型暂未接入：${options.model || '未选择'}`);
    error.statusCode = 400;
    throw error;
  }
  const instruction = buildInstruction(options);
  const userText = buildUserText({ ...options, imageCount: options.imageUrls?.length || 0 });
  const imageUrls = (options.imageUrls || []).slice(0, 10);
  let data;
  let text = '';

  if (spec.kind === 'chat') {
    const userContent = [
      { type: 'text', text: userText },
      ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
    ];
    data = await request(spec.path, {
      stream: false,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: userContent },
      ],
    });
    text = extractChatText(data);
  } else if (spec.kind === 'responses') {
    data = await request(spec.path, {
      model: spec.model,
      stream: false,
      max_output_tokens: 8192,
      reasoning: { effort: 'medium' },
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: `${instruction}\n\n${userText}` },
          ...imageUrls.map(url => ({ type: 'input_image', image_url: url })),
        ],
      }],
    });
    text = extractResponseText(data);
  } else {
    data = await request(spec.path, {
      model: spec.model,
      stream: false,
      max_tokens: 8192,
      system: instruction,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: userText },
          ...imageUrls.map(url => ({ type: 'image', source: { type: 'url', url } })),
        ],
      }],
    });
    text = extractClaudeText(data);
  }

  if (!text) {
    const error = new Error('模型调用成功，但没有返回可显示的文字内容');
    error.payload = data;
    throw error;
  }
  const rawUsage = data?.usage || {};
  const inputText = `${instruction}\n\n${userText}`;
  const estimatedInput = Math.max(1, Math.ceil(inputText.length / 3));
  const estimatedOutput = Math.max(1, Math.ceil(text.length / 3));
  const usage = {
    input_tokens: Number(rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? rawUsage.inputTokens ?? rawUsage.promptTokens) || estimatedInput,
    output_tokens: Number(rawUsage.output_tokens ?? rawUsage.completion_tokens ?? rawUsage.outputTokens ?? rawUsage.completionTokens) || estimatedOutput,
    provider_usage: Object.keys(rawUsage).length ? rawUsage : null,
    estimated: !Object.keys(rawUsage).length,
  };
  return {
    text,
    usage,
    providerCredits: data?.credits_consumed ?? data?.creditsConsumed ?? null,
  };
}

module.exports = { listModels, runAgent };
