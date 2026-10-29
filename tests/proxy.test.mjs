import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { config } from '../server/config.mjs';

async function probe(trustProxy, addresses) {
  const previous = config.trustProxy;
  config.trustProxy = trustProxy;
  const app = createApp();
  config.trustProxy = previous;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const results = [];
    for (const address of addresses) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address }, body: '{}',
      });
      results.push(response.status); await response.text();
    }
    return results;
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('proxy HTTP mantém limites independentes para visitantes distintos', async () => {
  assert.deepEqual(await probe(true, Array.from({ length: 21 }, (_, i) => `192.0.2.${i + 1}`)), Array(21).fill(400));
});
test('IP forjado antes do proxy não permite contornar o limite do visitante', async () => {
  const results = await probe(true, Array.from({ length: 21 }, (_, i) => `192.0.2.${i + 1}, 198.51.100.1`));
  assert.equal(results[19], 400); assert.equal(results[20], 429);
});
test('acesso direto ignora cabeçalhos de proxy não confiável', async () => {
  const results = await probe(false, Array.from({ length: 21 }, (_, i) => `203.0.113.${i + 1}`));
  assert.equal(results[19], 400); assert.equal(results[20], 429);
});
