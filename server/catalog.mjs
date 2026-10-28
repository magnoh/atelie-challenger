import { pool } from './db.mjs';
import { AppError, ensure } from './domain.mjs';
const API = 'https://collectionapi.metmuseum.org/public/collection';
const PAGE_SIZE = 24;
let allObjects;
let allObjectsLoading;
const exhibitionPages = new Map();
const exhibitionLoading = new Map();
export function normalize(item) {
  return { id: item.objectID, title: item.title, artist: item.artistDisplayName || 'Artista não identificado',
    date: item.objectDate, medium: item.medium, dimensions: item.dimensions,
    externalImage: item.primaryImageSmall || item.primaryImage, source: item.objectURL,
    publicDomain: item.isPublicDomain, imageUrl: `/api/catalog/${item.objectID}/image`, provider: 'The Metropolitan Museum of Art' };
}
async function api(path, timeout = 6000) {
  const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`The Met: ${response.status}`);
  return response.json();
}

// The complete ID list allows browsing beyond the search API's 10,000-result limit.
// Only IDs and a few recently viewed pages are kept in memory; images stay at the museum.
async function objectIds() {
  if (allObjects && allObjects.expires > Date.now()) return allObjects.ids;
  if (!allObjectsLoading) {
    allObjectsLoading = api('/v1/objects', 20000).then(async result => {
      ensure(Array.isArray(result.objectIDs), 'Catálogo externo inválido.', 503);
      const highlights = await api('/v1.1/search?hasImages=true&isHighlight=true&limit=100&offset=0').catch(() => ({ objectIDs: [] }));
      const priority = new Set(highlights.objectIDs || []);
      const ids = [...priority, ...result.objectIDs.filter(id => !priority.has(id))];
      allObjects = { ids, expires: Date.now() + 6 * 3600_000 };
      return allObjects.ids;
    }).finally(() => { allObjectsLoading = null; });
  }
  return allObjectsLoading;
}
export async function browseCatalog(query = '', page = 1) {
  const q = query.trim().slice(0, 100), key = JSON.stringify([q, page]);
  const cached = exhibitionPages.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  if (exhibitionLoading.has(key)) return exhibitionLoading.get(key);
  const request = (async () => {
    try {
      const offset = (page - 1) * PAGE_SIZE;
      let ids, total, reachable;
      if (q) {
        ensure(offset < 10000, 'Refine a busca para acessar mais resultados.', 400);
        const result = await api(`/v1.1/search?${new URLSearchParams({ q, hasImages: 'true', offset: String(offset), limit: String(Math.min(PAGE_SIZE, 10000 - offset)) })}`);
        ids = result.objectIDs || []; total = result.total || 0; reachable = Math.min(total, 10000);
      } else {
        const all = await objectIds();
        total = all.length; reachable = total; ids = all.slice(offset, offset + PAGE_SIZE);
      }
      let unavailable = 0;
      const items = [];
      // Limit concurrent detail requests instead of sending 24 at once.
      for (let start = 0; start < ids.length; start += 6) {
        const batch = await Promise.all(ids.slice(start, start + 6).map(async id => {
          try {
            const data = await api(`/v1/objects/${id}`);
            if (!data.isPublicDomain || !(data.primaryImageSmall || data.primaryImage)) return null;
            const item = normalize(data), url = new URL(item.externalImage);
            if (url.protocol !== 'https:' || url.hostname !== 'images.metmuseum.org') return null;
            return { ...item, imageUrl: item.externalImage };
          } catch { unavailable++; return null; }
        }));
        items.push(...batch.filter(Boolean));
      }
      if (ids.length && unavailable === ids.length) throw new Error('Detalhes indisponíveis');
      const result = { items, total, reachable, page, pageSize: PAGE_SIZE,
        hasNext: offset + ids.length < reachable, offline: false, partial: unavailable > 0,
        searchLimited: reachable < total, source: 'metropolitan' };
      exhibitionPages.set(key, { result, expires: Date.now() + 300_000 });
      if (exhibitionPages.size > 40) exhibitionPages.delete(exhibitionPages.keys().next().value);
      return result;
    } catch (error) {
      if (error instanceof AppError && error.status === 400) throw error;
      const pattern = `%${q}%`, offset = (page - 1) * PAGE_SIZE;
      const { rows } = await pool.query("SELECT snapshot FROM catalog WHERE snapshot->>'title' ILIKE $1 OR snapshot->>'artist' ILIKE $1 ORDER BY id LIMIT $2 OFFSET $3", [pattern, PAGE_SIZE + 1, offset]);
      return { items: rows.slice(0, PAGE_SIZE).map(r => r.snapshot), total: null, reachable: null,
        page, pageSize: PAGE_SIZE, hasNext: rows.length > PAGE_SIZE, offline: true, source: 'cache' };
    }
  })().finally(() => exhibitionLoading.delete(key));
  exhibitionLoading.set(key, request);
  return request;
}
export async function saveItem(item, client = pool) {
  await client.query('INSERT INTO catalog(id,snapshot) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [item.id, item]);
  return item;
}
export async function searchCatalog(query = '') {
  const q = query.trim().slice(0, 100);
  // The initial selection comes from saved API snapshots; searches consult the public API.
  if (!q) {
    const { rows } = await pool.query('SELECT snapshot FROM catalog ORDER BY id LIMIT 24');
    return { items: rows.map(r => r.snapshot), offline: false, source: 'saved' };
  }
  try {
    // The old /v1/search endpoint was retired; object details remain on /v1.
    const result = await api(`/v1.1/search?${new URLSearchParams({ q, hasImages: 'true', limit: '24', offset: '0' })}`);
    let unavailable = 0;
    const items = (await Promise.all((result.objectIDs || []).slice(0, 24).map(async id => {
      try {
        const item = await getItem(id);
        const { rows: [record] } = await pool.query('SELECT image IS NOT NULL AS saved FROM catalog WHERE id=$1', [id]);
        if (!record.saved) await cacheImage(item);
        return item;
      } catch (error) { if (!(error instanceof AppError) || error.status >= 500) unavailable++; return null; }
    }))).filter(Boolean).slice(0, 12);
    if (!items.length && unavailable) throw new Error('Detalhes das obras indisponíveis');
    return { items, offline: false, source: 'metropolitan' };
  } catch {
    const { rows } = await pool.query("SELECT snapshot FROM catalog WHERE snapshot->>'title' ILIKE $1 OR snapshot->>'artist' ILIKE $1 ORDER BY id LIMIT 24", [`%${q}%`]);
    return { items: rows.map(r => r.snapshot), offline: true, source: 'cache' };
  }
}
export async function getItem(id) {
  const { rows } = await pool.query('SELECT snapshot FROM catalog WHERE id=$1', [id]);
  if (rows[0]) return rows[0].snapshot;
  try {
    const data = await api(`/v1/objects/${Number(id)}`);
    ensure(data.isPublicDomain && (data.primaryImageSmall || data.primaryImage), 'Selecione uma obra em domínio público com imagem.');
    return saveItem(normalize(data));
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError('Não foi possível importar a obra. Tente um item do catálogo salvo.', 503); }
}
export async function cacheImage(item, client = pool) {
  try {
    const url = new URL(item.externalImage);
    ensure(url.protocol === 'https:' && url.hostname === 'images.metmuseum.org' && url.pathname.startsWith('/CRDImages/'), 'Origem de imagem inválida.');
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error('Imagem indisponível');
    ensure(Number(response.headers.get('content-length') || 0) <= 8_000_000, 'Imagem muito grande.');
    const data = Buffer.from(await response.arrayBuffer());
    ensure(data.length <= 8_000_000 && response.headers.get('content-type')?.startsWith('image/'), 'Imagem inválida.');
    await client.query('UPDATE catalog SET image=$2,image_type=$3 WHERE id=$1 AND image IS NULL', [item.id, data, 'image/jpeg']);
    return true;
  } catch { return false; }
}
