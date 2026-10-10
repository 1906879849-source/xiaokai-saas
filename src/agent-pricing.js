// 与钱包保持同一固定汇率，避免旧 Railway 变量把 Agent 价格切回百积分制。
const POINT_VALUE_RMB = 0.1;
const SALE_MULTIPLIER = Number(process.env.AGENT_SALE_MULTIPLIER || 2);

// Rivo 当前所选 GPT 标准 / Gemini 标准分组价格，单位为人民币 / 1M tokens。
// 面向用户的售价乘 2；缓存命中按上游缓存价计算，避免按普通输入价多收。
const PROFILES = {
  'GPT 5.5': { reference: 'gpt-5.5', inputRmbPerMillion: 0.65, cachedInputRmbPerMillion: 0.065, outputRmbPerMillion: 3.9 },
  'GPT 5.6 Luna': { reference: 'gpt-5.6-luna', inputRmbPerMillion: 0.026, cachedInputRmbPerMillion: 0.0026, outputRmbPerMillion: 0.156 },
  'Gemini 3.5 Flash': { reference: 'gemini-3.5-flash', inputRmbPerMillion: 0.75, cachedInputRmbPerMillion: 0.075, outputRmbPerMillion: 4.5 },
  'Gemini 3.1 Pro Preview': { reference: 'gemini-3.1-pro-preview', inputRmbPerMillion: 1, cachedInputRmbPerMillion: 0.1, outputRmbPerMillion: 6 },
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
  const cachedInputTokens = Number(
    usage.cached_input_tokens ?? usage.cachedInputTokens
    ?? usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0,
  ) || 0;
  return {
    inputTokens: Math.max(0, inputTokens),
    cachedInputTokens: Math.max(0, Math.min(inputTokens, cachedInputTokens)),
    outputTokens: Math.max(0, outputTokens),
  };
}

function quoteFromUsage(model, usage, options = {}) {
  const rates = profile(model);
  const normalized = normalizeUsage(usage);
  const fallback = options.fallbackUsage || { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 1000 };
  const hasUsage = normalized.inputTokens > 0 || normalized.outputTokens > 0;
  const used = hasUsage ? normalized : fallback;
  const providerRmb = (
    (used.inputTokens - (used.cachedInputTokens || 0)) * rates.inputRmbPerMillion
    + (used.cachedInputTokens || 0) * rates.cachedInputRmbPerMillion
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
    cachedInputTokens: used.cachedInputTokens || 0,
    outputTokens: used.outputTokens,
    inputRmbPerMillion: rates.inputRmbPerMillion,
    cachedInputRmbPerMillion: rates.cachedInputRmbPerMillion,
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
  return quoteFromUsage(model, null, { fallbackUsage: { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 1000 } });
}

module.exports = { PROFILES, profile, normalizeUsage, quoteFromUsage, estimate };
