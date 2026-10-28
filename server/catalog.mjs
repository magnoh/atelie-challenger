import { pool } from './db.mjs';
import { AppError, ensure } from './domain.mjs';
const API = 'https://collectionapi.metmuseum.org/public/collection';
export function normalize(item) {
  return { id: item.objectID, title: item.title, artist: item.artistDisplayName || 'Artista não identificado',
    date: item.objectDate, medium: item.medium, dimensions: item.dimensions,
    externalImage: item.primaryImageSmall || item.primaryImage, source: item.objectURL,
    publicDomain: item.isPublicDomain, imageUrl: `/api/catalog/${item.objectID}/image`, provider: 'The Metropolitan Museum of Art' };
}
async function api(path) {
  const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`The Met: ${response.status}`);
  return response.json();
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
