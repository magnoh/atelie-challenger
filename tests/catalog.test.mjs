import test from 'node:test';
import assert from 'node:assert/strict';
// These tests use an in-memory DB stub, never the configured real database.
process.env.AUDIT_SECRET ||= 'catalog-test-secret-of-at-least-32-characters';
const { pool } = await import('../server/db.mjs');
const { searchCatalog, browseCatalog } = await import('../server/catalog.mjs');
const artwork = { objectID: 987001, title: 'Obra de busca', artistDisplayName: 'Artista de busca',
  isPublicDomain: true, primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ep/web-large/test.jpg',
  objectURL: 'https://www.metmuseum.org/art/collection/search/987001' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
async function mocked(run, fetcher) {
  const originalFetch = globalThis.fetch, originalQuery = pool.query;
  const snapshots = new Map(), images = new Set(), calls = [];
  pool.query = async (sql, params = []) => {
    if (sql.startsWith('INSERT INTO catalog')) { snapshots.set(params[0], params[1]); return { rows: [] }; }
    if (sql.startsWith('UPDATE catalog SET image')) { images.add(params[0]); return { rows: [] }; }
    if (sql.includes('image IS NOT NULL')) return { rows: [{ saved: images.has(params[0]) }] };
    if (sql.includes('WHERE id=$1')) return { rows: snapshots.has(params[0]) ? [{ snapshot: snapshots.get(params[0]) }] : [] };
    return { rows: [...snapshots.values()].map(snapshot => ({ snapshot })) };
  };
  globalThis.fetch = async (url, options) => { calls.push(String(url)); return fetcher(String(url), options); };
  try { await run({ snapshots, images, calls }); }
  finally { globalThis.fetch = originalFetch; pool.query = originalQuery; }
}
test('busca usa v1.1, importa os atributos via v1 e persiste a imagem', async () => {
  await mocked(async ({ snapshots, images, calls }) => {
    const result = await searchCatalog('van Gogh');
    assert.equal(result.offline, false); assert.equal(result.source, 'metropolitan');
    assert.equal(result.items[0].title, artwork.title);
    assert.equal(snapshots.get(987001).provider, 'The Metropolitan Museum of Art');
    assert.ok(images.has(987001));
    const search = new URL(calls[0]);
    assert.equal(search.pathname, '/public/collection/v1.1/search');
    assert.equal(search.searchParams.get('q'), 'van Gogh');
    assert.equal(search.searchParams.get('limit'), '24');
    assert.ok(calls.some(url => url.endsWith('/v1/objects/987001')));
  }, async url => {
    if (url.includes('/v1.1/search?')) return json({ total: 1, objectIDs: [987001] });
    if (url.endsWith('/v1/objects/987001')) return json(artwork);
    if (url.startsWith('https://images.metmuseum.org/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
    throw new Error(`Endpoint inesperado: ${url}`);
  });
});
test('sem termo, identifica o catálogo salvo sem chamar a API', async () => {
  await mocked(async ({ snapshots, calls }) => {
    snapshots.set(1, { id: 1, title: 'Obra salva' });
    const result = await searchCatalog('');
    assert.equal(result.source, 'saved'); assert.equal(result.items.length, 1); assert.equal(calls.length, 0);
  }, () => { throw new Error('Não deve consultar API'); });
});
test('API de busca indisponível retorna catálogo salvo com aviso offline', async () => {
  await mocked(async ({ snapshots }) => {
    snapshots.set(1, { id: 1, title: 'Obra salva' });
    const result = await searchCatalog('Obra');
    assert.equal(result.offline, true); assert.equal(result.source, 'cache'); assert.equal(result.items.length, 1);
  }, () => new Response('Unavailable', { status: 503 }));
});
test('falha em todos os detalhes das obras também sinaliza indisponibilidade', async () => {
  await mocked(async () => {
    const result = await searchCatalog('van Gogh');
    assert.equal(result.offline, true); assert.equal(result.source, 'cache');
  }, url => url.includes('/v1.1/search?') ? json({ total: 1, objectIDs: [987001] }) : new Response('Unavailable', { status: 503 }));
});
test('obras sem domínio público não são importadas nem confundidas com falha da API', async () => {
  await mocked(async ({ snapshots }) => {
    const result = await searchCatalog('Artista');
    assert.equal(result.offline, false); assert.equal(result.items.length, 0); assert.equal(snapshots.size, 0);
  }, url => url.includes('/v1.1/search?') ? json({ total: 1, objectIDs: [987001] }) : json({ ...artwork, isPublicDomain: false }));
});
test('exposição pública pagina a lista completa sem copiar o acervo para o banco', async () => {
  await mocked(async ({ snapshots, images, calls }) => {
    const first = await browseCatalog('', 1), second = await browseCatalog('', 2);
    assert.equal(first.items.length, 24); assert.equal(first.hasNext, true); assert.equal(first.total, 25);
    assert.equal(second.items.length, 1); assert.equal(second.hasNext, false); assert.equal(second.items[0].id, 25);
    assert.equal(first.items[0].imageUrl, artwork.primaryImageSmall);
    assert.equal(snapshots.size, 0); assert.equal(images.size, 0);
    assert.equal(calls.filter(url => url.endsWith('/v1/objects')).length, 1);
    const before = calls.length;
    await browseCatalog('', 1);
    assert.equal(calls.length, before);
  }, url => {
    if (url.endsWith('/v1/objects')) return json({ objectIDs: Array.from({ length: 25 }, (_, i) => i + 1) });
    const id = Number(url.split('/').at(-1));
    return json({ ...artwork, objectID: id, title: `Obra ${id}` });
  });
});
test('busca pública usa offset e comunica o limite de resultados do museu', async () => {
  await mocked(async ({ calls }) => {
    const result = await browseCatalog('consulta paginada', 417);
    const search = new URL(calls[0]);
    assert.equal(search.searchParams.get('offset'), '9984'); assert.equal(search.searchParams.get('limit'), '16');
    assert.equal(result.searchLimited, true); assert.equal(result.reachable, 10000); assert.equal(result.hasNext, false);
    await assert.rejects(() => browseCatalog('consulta paginada', 418), /Refine a busca/);
  }, url => url.includes('/v1.1/search?') ? json({ total: 20000, objectIDs: Array.from({ length: 16 }, (_, i) => i + 1) }) : json(artwork));
});
test('exposição pública usa os dados salvos quando o museu falha', async () => {
  await mocked(async ({ snapshots }) => {
    snapshots.set(1, { id: 1, title: 'Obra salva' });
    const result = await browseCatalog('falha pública', 1);
    assert.equal(result.offline, true); assert.equal(result.items.length, 1); assert.equal(result.source, 'cache');
  }, () => new Response('Unavailable', { status: 503 }));
});
test('exposição não publica imagens sem domínio público', async () => {
  await mocked(async () => {
    const result = await browseCatalog('obra com direitos', 1);
    assert.equal(result.items.length, 0); assert.equal(result.offline, false);
  }, url => url.includes('/v1.1/search?') ? json({ total: 1, objectIDs: [987001] }) : json({ ...artwork, isPublicDomain: false }));
});
