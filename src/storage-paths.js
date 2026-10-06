const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

function configuredDataDir() {
  const value = process.env.WALLET_DATA_DIR
    || process.env.ACCOUNT_DATA_DIR
    || process.env.DATA_DIR
    || '';
  return value ? path.resolve(value) : '';
}

function generatedDir() {
  if (process.env.GENERATED_DIR) return path.resolve(process.env.GENERATED_DIR);

  // Production normally keeps account and wallet data in /app/storage/data.
  // When that persistent location is configured, keep generated images beside
  // it in /app/storage/generated even if GENERATED_DIR was accidentally omitted.
  const dataDir = configuredDataDir();
  if (dataDir) return path.join(path.dirname(dataDir), 'generated');

  return path.join(PROJECT_ROOT, 'generated');
}

module.exports = { configuredDataDir, generatedDir };
