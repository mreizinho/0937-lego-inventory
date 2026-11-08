const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app.js', 'utf8');
const start = source.indexOf('function scannerNoticeMarkup(');
const end = source.indexOf('function prepareScannerConfirmationSound(', start);
const status = {};
const context = { state: {}, document: { querySelector: () => status }, escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;') };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
for (const [type, title, glyph] of [['success', 'Adicionado', '✓'], ['warning', 'Sem stock', 'camera-warning-triangle'], ['info', 'Código não encontrado', '?']]) {
  context.updateScannerStatus('71487 <teste>', title, type);
  assert.equal(status.className, `camera-notice ${type}`);
  assert(status.innerHTML.includes(glyph));
  assert(status.innerHTML.includes(title));
  assert(status.innerHTML.includes('&lt;teste>'));
  assert.equal(context.state.scannerStatus, '71487 <teste>');
}
console.log('PASS: three scanner states, existing icons, escaped text and status updates.');
