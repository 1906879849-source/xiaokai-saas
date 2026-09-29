const crypto = require('crypto');

const tasks = new Map();

const ASPECT_SIZES = {
  '1:1': [1024, 1024],
  '16:9': [1024, 576],
  '9:16': [576, 1024],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '3:2': [1024, 683],
  '2:3': [683, 1024],
  '5:4': [1024, 819],
  '4:5': [819, 1024],
  '21:9': [1024, 439],
};

function normalizeAspectRatio(value) {
  const ratio = String(value || '').trim();
  return ASPECT_SIZES[ratio] ? ratio : '1:1';
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapPrompt(value, maxChars = 34, maxLines = 3) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!text) return ['(empty)'];
  const lines = [];
  for (let offset = 0; offset < text.length && lines.length < maxLines; offset += maxChars) {
    lines.push(text.slice(offset, offset + maxChars));
  }
  if (text.length > maxChars * maxLines) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  return lines;
}

function makeSvg(task) {
  const [width, height] = ASPECT_SIZES[task.aspectRatio];
  const shortSide = Math.min(width, height);
  const titleSize = Math.max(42, Math.round(shortSide * 0.08));
  const bodySize = Math.max(20, Math.round(shortSide * 0.027));
  const promptLines = wrapPrompt(task.prompt);
  const promptSvg = promptLines.map((line, index) =>
    `<tspan x="${Math.round(width * 0.11)}" dy="${index ? Math.round(bodySize * 1.35) : 0}">${escapeXml(line)}</tspan>`
  ).join('');
  const timestamp = new Date(task.createdAt + task.delayMs).toLocaleString('zh-CN', { hour12: false });
  const cardY = Math.round(height * 0.53);
  const lineGap = Math.round(bodySize * 1.65);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#0d1527"/><rect width="16" height="16" fill="#111d34"/><rect x="16" y="16" width="16" height="16" fill="#111d34"/></pattern>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1688ff"/><stop offset="1" stop-color="#635bff"/></linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="24" fill="none" stroke="url(#glow)" stroke-width="5"/>
  <path d="M24 110H92M24 24V92M${width - 24} 110H${width - 92}M${width - 24} 24V92M24 ${height - 110}H92M24 ${height - 24}V${height - 92}M${width - 24} ${height - 110}H${width - 92}M${width - 24} ${height - 24}V${height - 92}" stroke="#80c5ff" stroke-width="5"/>
  <text x="50%" y="${Math.round(height * 0.20)}" text-anchor="middle" fill="#8bc7ff" font-family="Arial,sans-serif" font-size="${Math.round(titleSize * 0.52)}" font-weight="700" letter-spacing="8">KAI</text>
  <text x="50%" y="${Math.round(height * 0.30)}" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="${titleSize}" font-weight="800">MOCK IMAGE</text>
  <rect x="${Math.round(width * 0.09)}" y="${Math.round(height * 0.39)}" width="${Math.round(width * 0.82)}" height="${Math.round(height * 0.47)}" rx="20" fill="#07101f" fill-opacity=".88" stroke="#2d4770"/>
  <g fill="#d8e8ff" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="${bodySize}">
    <text x="${Math.round(width * 0.11)}" y="${cardY}">Model: test-image</text>
    <text x="${Math.round(width * 0.11)}" y="${cardY + lineGap}">Size: ${width} × ${height} (${escapeXml(task.aspectRatio)})</text>
    <text x="${Math.round(width * 0.11)}" y="${cardY + lineGap * 2}">Prompt: <tspan x="${Math.round(width * 0.11)}" dy="${Math.round(bodySize * 1.35)}">${promptSvg}</tspan></text>
    <text x="${Math.round(width * 0.11)}" y="${cardY + lineGap * 4.65}">Task: ${escapeXml(task.taskId.slice(0, 26))}</text>
    <text x="${Math.round(width * 0.11)}" y="${cardY + lineGap * 5.65}">Time: ${escapeXml(timestamp)}</text>
  </g>
  <rect x="${Math.round(width * 0.11)}" y="${Math.round(height * 0.89)}" width="${Math.round(width * 0.78)}" height="${Math.max(42, Math.round(height * 0.055))}" rx="20" fill="#113d2a" stroke="#2bd67b"/>
  <text x="50%" y="${Math.round(height * 0.925)}" text-anchor="middle" dominant-baseline="middle" fill="#6ff0aa" font-family="Arial,sans-serif" font-size="${bodySize}" font-weight="800" letter-spacing="5">SUCCESS</text>
</svg>`;
}

async function createImageTask({ prompt, aspectRatio, resolution }) {
  const normalizedPrompt = String(prompt || '').trim();
  const mode = normalizedPrompt.toUpperCase();
  const delayMs = mode === '**SLOW**' ? 8000 : mode === '**FAIL**' ? 1000 : 1500;
  const taskId = `mock-${crypto.randomUUID()}`;
  tasks.set(taskId, {
    taskId,
    prompt: normalizedPrompt,
    aspectRatio: normalizeAspectRatio(aspectRatio),
    resolution: String(resolution || '1K'),
    createdAt: Date.now(),
    delayMs,
    shouldFail: mode === '**FAIL**',
  });
  return { taskId, model: 'test-image', taskApi: 'mock', warnings: [] };
}

async function getTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    const error = new Error('Mock task not found. The local server may have restarted.');
    error.statusCode = 404;
    throw error;
  }
  const elapsed = Date.now() - task.createdAt;
  const base = {
    taskId,
    model: 'test-image',
    resultUrls: [],
    failCode: '',
    failMsg: '',
    costTime: elapsed,
    creditsConsumed: 0,
  };
  if (elapsed < Math.min(350, task.delayMs * 0.25)) return { ...base, state: 'waiting', progress: 2 };
  if (elapsed < task.delayMs) {
    const progress = Math.min(95, Math.max(8, Math.round((elapsed / task.delayMs) * 92)));
    return { ...base, state: 'generating', progress };
  }
  if (task.shouldFail) {
    return {
      ...base,
      state: 'fail',
      progress: 100,
      failCode: 'MOCK_GENERATION_FAILED',
      failMsg: 'Mock image generation failed for testing.',
    };
  }
  const svg = makeSvg(task);
  return {
    ...base,
    state: 'success',
    progress: 100,
    resultUrls: [`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`],
  };
}

module.exports = { createImageTask, getTask };
