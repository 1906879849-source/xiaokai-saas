const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());

scripts.forEach((source, index) => {
  new vm.Script(source, { filename: `public/index.html:inline-script-${index + 1}` });
});

const required = [
  '/api/canvas-cloud',
  'syncCanvasCloudAfterLogin',
  'account:',
  "accept=\".md\"",
];
required.forEach(marker => {
  if (!html.includes(marker)) throw new Error(`missing required frontend feature: ${marker}`);
});

const removed = [
  'data-project-action="apiSettings"',
  'id="apiSettingsModal"',
  'function createVideoNode',
  'function applyVideoOutput',
  'ZIP Skill',
];
removed.forEach(marker => {
  if (html.includes(marker)) throw new Error(`legacy frontend marker still present: ${marker}`);
});

console.log(`PASS: ${scripts.length} inline browser scripts compile.`);
