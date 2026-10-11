const fs = require('fs');
const path = require('path');

const { configuredDataDir, generatedDir } = require('./storage-paths');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_MS = 7 * DAY_MS;

function dataRoot() {
  // Match canvas-cloud.js exactly when its dedicated storage location is set;
  // otherwise cleanup could scan the wrong directory and miss live references.
  return process.env.CANVAS_DATA_DIR
    ? path.resolve(process.env.CANVAS_DATA_DIR)
    : configuredDataDir() || path.join(__dirname, '..', 'data');
}

function safeJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function generatedNamesIn(value) {
  const names = new Set();
  const source = typeof value === 'string' ? value : JSON.stringify(value || null);
  // Backslashes delimit escaped quotes in JSON.stringify output, so exclude
  // them from both the optional host and file-name portions.
  const pattern = /(?:https?:\/\/[^\s\\"'<>]+)?\/generated\/([^\s\\"'<>?#]+)/gi;
  let match;
  while ((match = pattern.exec(source))) {
    try {
      const name = decodeURIComponent(match[1]);
      if (name && path.basename(name) === name) names.add(name);
    } catch {}
  }
  return names;
}

function collectCanvasReferences(root) {
  const references = new Set();
  const canvasRoot = path.join(root, 'canvas-cloud');
  if (!fs.existsSync(canvasRoot)) return references;
  const users = fs.readdirSync(canvasRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
  for (const user of users) {
    const userRoot = path.join(canvasRoot, user.name);
    for (const entry of fs.readdirSync(userRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const record = safeJson(path.join(userRoot, entry.name), null);
      if (!record || !Object.prototype.hasOwnProperty.call(record, 'value')) continue;
      generatedNamesIn(record.value).forEach(name => references.add(name));
    }
  }
  return references;
}

function stateFile(root) {
  return path.join(root, 'generated-cleanup.json');
}

function persistState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function cleanupGeneratedAssets(options = {}) {
  const root = path.resolve(options.dataRoot || dataRoot());
  const imagesRoot = path.resolve(options.generatedRoot || generatedDir());
  const now = Number(options.now || Date.now());
  const retentionMs = Math.max(DAY_MS, Number(options.retentionMs || process.env.GENERATED_UNREFERENCED_TTL_MS || DEFAULT_RETENTION_MS));
  const file = options.stateFile || stateFile(root);
  const references = options.references || collectCanvasReferences(root);
  const state = safeJson(file, { version: 1, unreferencedSince: {} });
  if (!state.unreferencedSince || typeof state.unreferencedSince !== 'object') state.unreferencedSince = {};
  const report = { referenced: references.size, examined: 0, pending: 0, removed: 0, removedBytes: 0 };

  fs.mkdirSync(imagesRoot, { recursive: true });
  const present = new Set();
  for (const entry of fs.readdirSync(imagesRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    present.add(name);
    report.examined += 1;
    if (references.has(name)) {
      delete state.unreferencedSince[name];
      continue;
    }
    const full = path.join(imagesRoot, name);
    const stat = fs.statSync(full);
    const firstSeen = Number(state.unreferencedSince[name]) || now;
    state.unreferencedSince[name] = firstSeen;
    if (now - firstSeen < retentionMs) {
      report.pending += 1;
      continue;
    }
    fs.unlinkSync(full);
    delete state.unreferencedSince[name];
    report.removed += 1;
    report.removedBytes += stat.size;
  }
  Object.keys(state.unreferencedSince).forEach(name => { if (!present.has(name)) delete state.unreferencedSince[name]; });
  state.version = 1;
  state.lastRunAt = now;
  state.retentionMs = retentionMs;
  persistState(file, state);
  return report;
}

module.exports = {
  DAY_MS,
  DEFAULT_RETENTION_MS,
  generatedNamesIn,
  collectCanvasReferences,
  cleanupGeneratedAssets,
};
