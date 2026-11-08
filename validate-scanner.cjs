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
assert.equal(context.scannerResultIcon('warning'), '!');
assert.equal(context.scannerResultIcon('info'), '?');
for (const [type, title] of [['success', 'Adicionado'], ['warning', 'Sem stock'], ['info', 'Código não encontrado']]) {
  context.updateScannerStatus('1 un. na leitura.', title, type, '71487 · Set <teste>');
  assert.equal(status.className, `camera-notice ${type}`);
  assert(!status.innerHTML.includes('camera-notice-icon'));
  assert(!status.innerHTML.includes('<svg'));
  assert(status.innerHTML.indexOf(title) < status.innerHTML.indexOf('71487'));
  assert(status.innerHTML.indexOf('71487') < status.innerHTML.indexOf('1 un. na leitura.'));
  assert(status.innerHTML.includes(title));
  assert(status.innerHTML.includes('&lt;teste>'));
  assert.equal(context.state.scannerStatus, '1 un. na leitura.');
}
const instruction = context.scannerNoticeMarkup('A preparar a câmara…');
assert(!instruction.includes('camera-notice-set'));
console.log('PASS: three toast states, message/set/status ordering, no toast icons, escaped text and camera instructions.');
