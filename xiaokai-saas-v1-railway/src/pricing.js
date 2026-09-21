// 对用户展示：1 元 = 10 积分。内部使用 units，10 units = 1 积分。
const UNITS_PER_POINT = 10;
const POINTS_PER_YUAN = 10;

// V1 建议售价。后续接管理后台后可改成数据库动态价格。
const PRICE_POINTS = {
  'GPT-4o Image':      { '1K': 3, '2K': 3, '4K': 3 },
  'GPT Image 1.5':     { '1K': 3, '2K': 5, '4K': 8 },
  'GPT Image 2':       { '1K': 3, '2K': 5, '4K': 8 },
  'GPT Image -All':    { '1K': 3, '2K': 5, '4K': 8 },
  'Nano Banana':       { '1K': 3, '2K': 3, '4K': 3 },
  'Nano Banana - Fal': { '1K': 3, '2K': 3, '4K': 3 },
  'Nano Banana Pro':   { '1K': 6, '2K': 6, '4K': 9 },
  'Nano Banana Pro - Fal': { '1K': 6, '2K': 6, '4K': 9 },
  'Nano Banana 2':     { '1K': 4, '2K': 6, '4K': 9 },
  'Nano Banana 2 Lite':{ '1K': 3, '2K': 5, '4K': 7 },
  'Nano Banana 2 - Fal': { '1K': 4, '2K': 6, '4K': 9 },
  'Gemini 2.5 Flash 官': { '1K': 3, '2K': 3, '4K': 3 },
  'Gemini 3.1 Flash 官': { '1K': 4, '2K': 6, '4K': 9 },
  'Gemini 3 Pro 官':     { '1K': 6, '2K': 6, '4K': 9 },
};

function normalizeResolution(v) {
  const r = String(v || '').toUpperCase();
  return ['1K','2K','4K'].includes(r) ? r : '2K';
}

function pricePoints(model, resolution) {
  const row = PRICE_POINTS[model];
  if (!row) return null;
  return row[normalizeResolution(resolution)] ?? row['2K'];
}

function priceUnits(model, resolution) {
  const p = pricePoints(model, resolution);
  return p == null ? null : Math.round(p * UNITS_PER_POINT);
}

module.exports = { UNITS_PER_POINT, POINTS_PER_YUAN, PRICE_POINTS, pricePoints, priceUnits, normalizeResolution };
