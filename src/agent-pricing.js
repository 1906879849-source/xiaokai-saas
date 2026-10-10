// 与钱包保持同一固定汇率，避免旧 Railway 变量把 Agent 价格切回百积分制。
const POINT_VALUE_RMB = 0.1;
const SALE_MULTIPLIER = Number(process.env.AGENT_SALE_MULTIPLIER || 2);

// OtterL 公开价格，单位为人民币 / 1M tokens。面向用户的售价乘 2。
const PROFILES = {
  'GPT 5.5 Vision · 省积分': { reference: 'gpt-5.5', inputRmbPerMillion: 1.5, outputRmbPerMillion: 9 },
  'GPT 5.5 Vision · 高质量': { reference: 'gpt-5.5', inputRmbPerMillion: 1.5, outputRmbPerMillion: 9 },
  'Gemini 3.1 Flash Lite · 省积分': { reference: 'gemini-3.1-flash-lite', inputRmbPerMillion: 0.1, outputRmbPerMillion: 0.6 },
  'Gemini 3 Flash · 标准': { reference: 'gemini-3-flash', inputRmbPerMillion: 0.2, outputRmbPerMillion: 1.2 },
};

function profile(model) {
  const value = PROFILES[model];
  if (!value) {
    const error = new Error(`Agent 模型未配置用量价格：${model || '未选择'}`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function normalizeUsage(usage = {}) {
  usage = usage || {};
  const inputTokens = Number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens ?? 0,
  ) || 0;
  const outputTokens = Number(
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens ?? 0,
  ) || 0;
  return { inputTokens: Math.max(0, inputTokens), outputTokens: Math.max(0, outputTokens) };
}

function quoteFromUsage(model, usage, options = {}) {
  const rates = profile(model);
  const normalized = normalizeUsage(usage);
  const fallback = options.fallbackUsage || { inputTokens: 2000, outputTokens: 1000 };
  const hasUsage = normalized.inputTokens > 0 || normalized.outputTokens > 0;
  const used = hasUsage ? normalized : fallback;
  const providerRmb = (
    used.inputTokens * rates.inputRmbPerMillion
    + used.outputTokens * rates.outputRmbPerMillion
  ) / 1_000_000;
  const userRmbRaw = providerRmb * SALE_MULTIPLIER;
  const points = Math.max(1, Math.ceil((userRmbRaw / POINT_VALUE_RMB) - 1e-9));
  return {
    model: `Agent · ${model}`,
    billing: 'usage',
    estimated: !hasUsage,
    referenceModel: rates.reference,
    inputTokens: used.inputTokens,
    outputTokens: used.outputTokens,
    inputRmbPerMillion: rates.inputRmbPerMillion,
    outputRmbPerMillion: rates.outputRmbPerMillion,
    providerRmb: Number(providerRmb.toFixed(6)),
    multiplier: SALE_MULTIPLIER,
    unit: points,
    total: points,
    count: 1,
    pointValueRmb: POINT_VALUE_RMB,
    unitRmb: Number((points * POINT_VALUE_RMB).toFixed(2)),
    totalRmb: Number((points * POINT_VALUE_RMB).toFixed(2)),
  };
}

function estimate(model) {
  return quoteFromUsage(model, null, { fallbackUsage: { inputTokens: 2000, outputTokens: 1000 } });
}

module.exports = { PROFILES, profile, normalizeUsage, quoteFromUsage, estimate };
