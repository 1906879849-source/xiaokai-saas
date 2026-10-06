const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());

scripts.forEach((source, index) => {
  new vm.Script(source, { filename: `public/index.html:inline-script-${index + 1}` });
});

console.log(`PASS: ${scripts.length} inline browser scripts compile.`);
