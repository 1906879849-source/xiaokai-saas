const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.WALLET_DATA_DIR || process.env.ACCOUNT_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const FILE = path.join(DATA_DIR, 'platform-settings.json');

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const SETTINGS_VERSION = 4;

const DEFAULT_MODELS = [
  { name: 'Nano Banana 2', provider: 'rivo', id: 'nano-banana-2', taskApi: 'rivo', enabled: true, resolutions: ['1K', '2K', '4K'], prices: { '1K': intEnv('PRICE_RIVO_NANO_BANANA_2_1K', 3), '2K': intEnv('PRICE_RIVO_NANO_BANANA_2_2K', 4), '4K': intEnv('PRICE_RIVO_NANO_BANANA_2_4K', 5) } },
  { name: 'Nano Banana Pro', provider: 'rivo', id: 'nano-banana-pro', taskApi: 'rivo', enabled: true, resolutions: ['1K', '2K', '4K'], prices: { '1K': intEnv('PRICE_RIVO_NANO_BANANA_PRO_1K', 3), '2K': intEnv('PRICE_RIVO_NANO_BANANA_PRO_2K', 5), '4K': intEnv('PRICE_RIVO_NANO_BANANA_PRO_4K', 6) } },
  { name: 'GPT Image 2', provider: 'rivo', id: 'gpt-image-2', taskApi: 'rivo', enabled: true, resolutions: ['1K', '2K', '4K'], prices: { '1K': intEnv('PRICE_RIVO_GPT_IMAGE_2_1K', 2), '2K': intEnv('PRICE_RIVO_GPT_IMAGE_2_2K', 3), '4K': intEnv('PRICE_RIVO_GPT_IMAGE_2_4K', 5) } },
  { name: 'GPT Image 2.5 Flare', provider: 'rivo', id: 'gpt-image-2.5-flare', taskApi: 'rivo', enabled: true, resolutions: ['1K'], prices: { '1K': intEnv('PRICE_RIVO_GPT_IMAGE_2_5_FLARE_1K', 3) } },
  { name: 'GPT Image 2.5 Sunburst', provider: 'rivo', id: 'gpt-image-2.5-sunburst', taskApi: 'rivo', enabled: true, resolutions: ['1K'], prices: { '1K': intEnv('PRICE_RIVO_GPT_IMAGE_2_5_SUNBURST_1K', 4) } },
];

function defaults() {
  return {
    version: SETTINGS_VERSION,
    updatedAt: Date.now(),
    maintenance: { enabled: false, title: '系统维护中', message: '正在进行服务升级，请稍后再试。', expectedEnd: '' },
    models: DEFAULT_MODELS.map(item => ({ ...item, resolutions: [...item.resolutions], prices: { ...item.prices } })),
  };
}

function normalizeResolution(value) {
  const upper = String(value || '').trim().toUpperCase();
  return ['1K', '2K', '4K'].includes(upper) ? upper : '';
}

function normalizeModel(input, fallback) {
  const allowedResolutions = [...new Set((Array.isArray(input?.resolutions) ? input.resolutions : fallback.resolutions).map(normalizeResolution).filter(Boolean))];
  if (!allowedResolutions.length) throw Object.assign(new Error(`${fallback.name} 至少需要保留一个分辨率`), { statusCode: 400 });
  const prices = {};
  for (const resolution of allowedResolutions) {
    const value = Number(input?.prices?.[resolution] ?? fallback.prices?.[resolution] ?? fallback.prices?.[fallback.resolutions[0]] ?? 0);
    if (!Number.isInteger(value) || value < 0 || value > 1000000) throw Object.assign(new Error(`${fallback.name} 的 ${resolution} 价格必须是有效整数`), { statusCode: 400 });
    prices[resolution] = value;
  }
  const fixedResolution = fallback.fixedResolution && allowedResolutions.includes(fallback.fixedResolution) ? fallback.fixedResolution : '';
  return {
    ...fallback,
    id: String(input?.id ?? fallback.id).trim().slice(0, 160) || fallback.id,
    enabled: input?.enabled !== false,
    resolutions: allowedResolutions,
    prices,
    ...(fixedResolution ? { fixedResolution } : {}),
  };
}

function normalize(raw = {}) {
  const base = defaults();
  const byName = new Map((Array.isArray(raw.models) ? raw.models : []).map(item => [String(item?.name || ''), item]));
  const maintenance = raw.maintenance || {};
  const rawVersion = Number(raw.version) || 1;
  return {
    version: SETTINGS_VERSION,
    updatedAt: Number(raw.updatedAt) || base.updatedAt,
    updatedBy: String(raw.updatedBy || '').slice(0, 120),
    maintenance: {
      enabled: maintenance.enabled === true,
      title: String(maintenance.title || base.maintenance.title).trim().slice(0, 80) || base.maintenance.title,
      message: String(maintenance.message || base.maintenance.message).trim().slice(0, 1000) || base.maintenance.message,
      expectedEnd: String(maintenance.expectedEnd || '').trim().slice(0, 80),
    },
    models: base.models.map(fallback => {
      const saved = byName.get(fallback.name);
      // Version 4 replaces the former OtterL/KIE menu with the selected Rivo
      // catalogue and the new 1 yuan = 10 points price scale.
      if (rawVersion < SETTINGS_VERSION) {
        return normalizeModel({
          ...saved,
          resolutions: fallback.resolutions,
          prices: fallback.prices,
        }, fallback);
      }
      return normalizeModel(saved, fallback);
    }),
  };
}

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const normalized = normalize(raw);
    if (Number(raw?.version || 1) < SETTINGS_VERSION) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const backup = `${FILE}.before-rivo-v4.bak`;
      if (!fs.existsSync(backup)) fs.copyFileSync(FILE, backup);
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
      fs.renameSync(tmp, FILE);
    }
    return normalized;
  }
  catch { return defaults(); }
}

function write(value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const normalized = normalize(value);
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmp, FILE);
  return normalized;
}

function publicModels({ includeDisabled = false } = {}) {
  return read().models.filter(model => includeDisabled || model.enabled).map(model => ({ ...model, prices: { ...model.prices } }));
}

function resolveModel(name, { includeDisabled = false } = {}) {
  return publicModels({ includeDisabled }).find(model => model.name === name) || null;
}

function priceFor(modelName, resolution) {
  const model = resolveModel(modelName);
  if (!model) return null;
  const normalized = normalizeResolution(resolution) || model.fixedResolution || model.resolutions[0];
  if (!model.resolutions.includes(normalized)) return null;
  return { resolution: normalized, unit: model.prices[normalized] };
}

function updateMaintenance(input, actor = '') {
  const current = read();
  current.maintenance = { ...current.maintenance, ...(input || {}) };
  current.updatedAt = Date.now(); current.updatedBy = String(actor || '');
  return write(current);
}

function updateModels(input, actor = '') {
  const current = read();
  current.models = Array.isArray(input) ? input : [];
  current.updatedAt = Date.now(); current.updatedBy = String(actor || '');
  return write(current);
}

module.exports = { read, publicModels, resolveModel, priceFor, updateMaintenance, updateModels, normalizeResolution };
