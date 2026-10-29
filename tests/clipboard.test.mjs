import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../client/clipboard.js';

function browser(result = true) {
  const state = { removed: false, restored: false, selected: false };
  const field = { style: {}, select() { state.selected = true; }, remove() { state.removed = true; } };
  return { state, isSecureContext: false, navigator: {}, document: {
    activeElement: { focus() { state.restored = true; } },
    createElement: () => field, body: { appendChild() {} },
    execCommand(command) { assert.equal(command, 'copy'); assert.equal(field.value, 'https://example.com/#/receipt/1'); return result; },
  } };
}
const link = 'https://example.com/#/receipt/1';
test('HTTPS usa a API de clipboard', async () => {
  let copied;
  assert.equal(await copyText(link, { isSecureContext: true, navigator: { clipboard: { writeText: async text => { copied = text; } } } }), true);
  assert.equal(copied, link);
});
test('HTTP copia com fallback e restaura foco', async () => {
  const b = browser(); assert.equal(await copyText(link, b), true);
  assert.deepEqual(b.state, { removed: true, restored: true, selected: true });
});
test('clipboard negado tenta fallback', async () => {
  const b = browser(); b.isSecureContext = true;
  b.navigator.clipboard = { writeText: async () => { throw Error('denied'); } };
  assert.equal(await copyText(link, b), true);
});
test('falha de cópia permite mostrar link manual sem anunciar sucesso', async () => {
  const b = browser(false); assert.equal(await copyText(link, b), false);
  assert.equal(b.state.removed, true);
});
