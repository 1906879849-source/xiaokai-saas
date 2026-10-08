const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = path.resolve(
  process.env.CANVAS_DATA_DIR ||
  process.env.ACCOUNT_DATA_DIR ||
  process.env.WALLET_DATA_DIR ||
  process.env.DATA_DIR ||
  path.join(__dirname, '..', 'data')
);
const ROOT = path.join(DATA_ROOT, 'canvas-cloud');
const MAX_VALUE_BYTES = Math.max(1024 * 1024, Number(process.env.CANVAS_CLOUD_MAX_BYTES) || 60 * 1024 * 1024);
const ALLOWED_KEYS = /^(?:current|project-index|asset-library|skill-library|snapshot-latest|project:[a-zA-Z0-9_-]{1,120}|snapshots:[a-zA-Z0-9_-]{1,120})$/;

function normalizeKey(value) {
  const key = String(value || '').trim();
  if (!ALLOWED_KEYS.test(key)) {
    const error = new Error('云端画布数据键无效');
    error.statusCode = 400;
    throw error;
  }
  return key;
}

function userDirectory(userId) {
  const safeUser = crypto.createHash('sha256').update(String(userId || '')).digest('hex');
  return path.join(ROOT, safeUser);
}

function fileFor(userId, key) {
  const normalized = normalizeKey(key);
  const name = crypto.createHash('sha256').update(normalized).digest('hex');
  return { normalized, file: path.join(userDirectory(userId), `${name}.json`) };
}

function read(userId, key) {
  const { file } = fileFor(userId, key);
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return record && record.key === normalizeKey(key) ? record : null;
  } catch {
    const error = new Error('云端画布数据损坏');
    error.statusCode = 500;
    throw error;
  }
}

function write(userId, key, value) {
  const { normalized, file } = fileFor(userId, key);
  const record = { version: 1, key: normalized, updatedAt: Date.now(), value };
  const payload = JSON.stringify(record);
  if (Buffer.byteLength(payload) > MAX_VALUE_BYTES) {
    const error = new Error(`云端画布数据超过 ${(MAX_VALUE_BYTES / 1024 / 1024).toFixed(0)}MB 上限，请减少画布内嵌原图后重试`);
    error.statusCode = 413;
    throw error;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, file);
  return { key: normalized, updatedAt: record.updatedAt };
}

function remove(userId, key) {
  const { file } = fileFor(userId, key);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

module.exports = { read, write, remove, normalizeKey };
