import { pool } from './db.mjs';
import { AppError, ensure } from './domain.mjs';
import { departments } from '../shared/exhibition-options.js';
const API = 'https://collectionapi.metmuseum.org/public/collection';
const PAGE_SIZE = 6;
const objectLists = new Map();
const objectListsLoading = new Map();
const detailCache = new Map();
const detailsLoading = new Map();
const folded = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const exhibitionPages = new Map();
const exhibitionLoading = new Map();
export function normalize(item) {
  return { id: item.objectID, title: item.title, artist: item.artistDisplayName || 'Artista não identificado',
    date: item.objectDate, medium: item.medium, dimensions: item.dimensions,
    department: item.department || '', objectType: item.objectName || '', classification: item.classification || '',
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
async function objectIds(departmentId = '') {
  const cached = objectLists.get(departmentId);
  if (cached && cached.expires > Date.now()) return cached.ids;
  if (!objectListsLoading.has(departmentId)) {
    const suffix = departmentId ? `?departmentIds=${departmentId}` : '';
    const highlightsQuery = new URLSearchParams({ hasImages: 'true', isHighlight: 'true', limit: '100', offset: '0' });
    if (departmentId) highlightsQuery.set('departmentId', departmentId);
    const loading = Promise.all([
      api(`/v1/objects${suffix}`),
      api(`/v1.1/search?${highlightsQuery}`).catch(() => ({ objectIDs: [] })),
    ]).then(([result, highlights]) => {
      ensure(Array.isArray(result.objectIDs), 'Catálogo externo inválido.', 503);
      const priority = new Set(highlights.objectIDs || []);
      const ids = [...priority, ...result.objectIDs.filter(id => !priority.has(id))];
      objectLists.set(departmentId, { ids, expires: Date.now() + 6 * 3600_000 });
      return ids;
    }).finally(() => objectListsLoading.delete(departmentId));
    objectListsLoading.set(departmentId, loading);
  }
  return objectListsLoading.get(departmentId);
}
async function exhibitionItem(id) {
  const cached = detailCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.item;
  if (detailsLoading.has(id)) return detailsLoading.get(id);
  const request = api(`/v1/objects/${id}`).then(data => {
    let item = null;
    if (data.isPublicDomain && (data.primaryImageSmall || data.primaryImage)) {
      const normalized = normalize(data), url = new URL(normalized.externalImage);
      if (url.protocol === 'https:' && url.hostname === 'images.metmuseum.org') item = { ...normalized, imageUrl: normalized.externalImage };
    }
    detailCache.set(id, { item, expires: Date.now() + 3600_000 });
    if (detailCache.size > 600) detailCache.delete(detailCache.keys().next().value);
    return item;
  }).finally(() => detailsLoading.delete(id));
  detailsLoading.set(id, request);
  return request;
}
export async function browseCatalog(query = '', page = 1, filters = {}) {
  const q = query.trim().slice(0, 100), mode = filters.mode || 'all';
  const departmentId = filters.departmentId ? String(filters.departmentId) : '', medium = filters.medium || '';
  const offset = filters.offset ?? (page - 1) * PAGE_SIZE;
  const key = JSON.stringify([q, page, mode, departmentId, medium, offset]);
  const cached = exhibitionPages.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  if (exhibitionLoading.has(key)) return exhibitionLoading.get(key);
  const request = (async () => {
    try {
      const searching = !!(q || medium);
      if (searching) ensure(offset < 10000, 'Refine a busca para acessar mais resultados.', 400);
      const all = searching ? null : await objectIds(departmentId);
      let total = all?.length || 0, reachable = total, cursor = offset, unavailable = 0, inspected = 0;
      const items = [];
      // Fill six visible slots, but bound work on pages with missing/public-domain images.
      for (let round = 0; round < 3 && items.length < PAGE_SIZE; round++) {
        let ids;
        if (searching) {
          if (cursor >= 10000) break;
          const params = new URLSearchParams({ q, hasImages: 'true', offset: String(cursor), limit: String(Math.min(PAGE_SIZE, 10000 - cursor)) });
          if (mode === 'artist') params.set('artistOrCulture', 'true');
          if (mode === 'title') params.set('title', 'true');
          if (departmentId) params.set('departmentId', departmentId);
          if (medium) params.set('medium', medium);
          const result = await api(`/v1.1/search?${params}`);
          ids = result.objectIDs || []; total = result.total || 0; reachable = Math.min(total, 10000);
        } else ids = all.slice(cursor, cursor + PAGE_SIZE);
        if (!ids.length) { cursor = reachable; break; }
        const batch = await Promise.all(ids.map(async id => {
          try {
            const item = await exhibitionItem(id);
            // The API also searches culture; the author control must match the artist.
            if (mode === 'artist' && q && !folded(item?.artist).includes(folded(q))) return null;
            return item;
          } catch { unavailable++; return null; }
        }));
        inspected += ids.length;
        for (const item of batch) {
          cursor++;
          if (item) items.push(item);
          if (items.length === PAGE_SIZE) break;
        }
        if (cursor >= reachable || unavailable === inspected) break;
      }
      if (inspected && unavailable === inspected) throw new Error('Detalhes indisponíveis');
      const result = { items, total, reachable, page, pageSize: PAGE_SIZE,
        nextOffset: cursor, hasNext: cursor < reachable, offline: false, partial: unavailable > 0,
        searchLimited: reachable < total, source: 'metropolitan' };
      if (!result.partial) exhibitionPages.set(key, { result, expires: Date.now() + 300_000 });
      if (exhibitionPages.size > 40) exhibitionPages.delete(exhibitionPages.keys().next().value);
      return result;
    } catch (error) {
      if (error instanceof AppError && error.status === 400) throw error;
      const pattern = `%${q}%`, savedOffset = (page - 1) * PAGE_SIZE;
      const department = departments.find(d => String(d.id) === departmentId)?.name || '';
      const { rows } = await pool.query(`SELECT snapshot FROM catalog WHERE
        (($2='artist' AND snapshot->>'artist' ILIKE $1) OR ($2='title' AND snapshot->>'title' ILIKE $1)
          OR ($2='all' AND (snapshot->>'title' ILIKE $1 OR snapshot->>'artist' ILIKE $1)))
        AND ($3='' OR snapshot->>'department'=$3)
        AND ($4='' OR snapshot->>'classification' ILIKE $4 OR snapshot->>'objectType' ILIKE $4 OR snapshot->>'medium' ILIKE $4)
        ORDER BY id LIMIT $5 OFFSET $6`, [pattern, mode, department, medium ? `%${medium.replace(/s$/, '')}%` : '', PAGE_SIZE + 1, savedOffset]);
      return { items: rows.slice(0, PAGE_SIZE).map(r => r.snapshot), total: null, reachable: null,
        page, pageSize: PAGE_SIZE, nextOffset: offset, hasNext: rows.length > PAGE_SIZE, offline: true, source: 'cache' };
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
