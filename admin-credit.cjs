const wallet = require('./src/wallet');
try {
  const amount = Number(process.argv[2]);
  const result = wallet.grant(amount);
  console.log(`Added ${amount} test credits. Available balance: ${result.available}`);
} catch (error) {
  console.error('[ERROR]', error.message);
  process.exitCode = 1;
}
