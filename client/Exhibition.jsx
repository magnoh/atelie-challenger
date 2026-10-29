import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { departments, media } from '../shared/exhibition-options';
import './exhibition.css';

const initialFilters = { q: '', mode: 'all', departmentId: '', medium: '' };
const pageKey = (filters, page, offset) => new URLSearchParams({ ...filters, page: String(page), offset: String(offset) }).toString();

export function Exhibition() {
  const section = useRef(null), cache = useRef(new Map()), pending = useRef(new Map());
  const [visible, setVisible] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterButton = useRef(null);
  const [draft, setDraft] = useState(initialFilters), [filters, setFilters] = useState(initialFilters);
  const [offsets, setOffsets] = useState([0]), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const key = pageKey(filters, page, offsets[page - 1]);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    observer.observe(section.current);
    return () => observer.disconnect();
  }, []);

  function remember(requestKey, result) {
    if (result.offline || result.partial) return;
    cache.current.set(requestKey, { result, expires: Date.now() + 300000 });
    if (cache.current.size > 20) cache.current.delete(cache.current.keys().next().value);
  }
  useEffect(() => {
    if (!visible) return;
    const cached = cache.current.get(key);
    if (cached?.expires > Date.now()) { setData(cached.result); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`/exhibition?${key}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { remember(key, result); setData(result); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visible, key, retry]);

  const updateDraft = event => setDraft(value => ({ ...value, [event.target.name]: event.target.value }));
  const closeFilters = () => { setFiltersOpen(false); filterButton.current?.focus(); };
  const applyFilters = next => {
    setFilters({ ...next, q: next.q.trim() }); setPage(1); setOffsets([0]); setData(null); setLoading(true);
    cache.current.clear(); setRetry(value => value + 1); setVisible(true);
  };
  const changePage = next => {
    if (loading) return;
    if (next > page) setOffsets(current => [...current.slice(0, page), data.nextOffset]);
    setPage(next); setLoading(true);
    section.current.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  const prefetchNext = () => {
    if (loading || !data?.hasNext || data.offline) return;
    const nextKey = pageKey(filters, page + 1, data.nextOffset);
    if (cache.current.get(nextKey)?.expires > Date.now() || pending.current.has(nextKey)) return;
    const request = api(`/exhibition?${nextKey}`).then(result => remember(nextKey, result)).catch(() => {}).finally(() => pending.current.delete(nextKey));
    pending.current.set(nextKey, request);
  };
  return <section ref={section} id="exhibition" className="catalog-section exhibition-section" aria-busy={loading}>
    <div className="section-heading"><div><p className="eyebrow">THE METROPOLITAN MUSEUM OF ART</p><h2>Acervo em exposição</h2></div><a className="text-link" href="#lots" onClick={e => { e.preventDefault(); document.getElementById('lots').scrollIntoView({ behavior: 'smooth' }); }}>Ver lotes em leilão ↓</a></div>
    <div className="exhibition-toolbar"><p className="muted exhibition-intro">Descubra obras em páginas de 6.</p><button ref={filterButton} type="button" className="exhibition-filter-toggle" aria-label={filtersOpen ? 'Fechar filtros' : 'Abrir filtros'} title="Filtros" aria-expanded={filtersOpen} aria-controls="exhibition-filters" onClick={() => setFiltersOpen(open => !open)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8Z"/></svg>
      {(filters.q || filters.departmentId || filters.medium) && <span className="filter-active-dot" aria-hidden="true"/>}
    </button></div>
    <form id="exhibition-filters" className="exhibition-filters" hidden={!filtersOpen} onKeyDown={event => { if (event.key === 'Escape') closeFilters(); }} onSubmit={event => { event.preventDefault(); applyFilters(draft); closeFilters(); }}>
      <div><label htmlFor="exhibition-mode">Buscar por</label><select id="exhibition-mode" name="mode" value={draft.mode} onChange={updateDraft}><option value="all">Palavra-chave</option><option value="title">Título da obra</option><option value="artist">Autor</option></select></div>
      <div className="exhibition-query"><label htmlFor="exhibition-query">{draft.mode === 'artist' ? 'Nome do autor' : 'Busca'}</label><input id="exhibition-query" name="q" value={draft.q} maxLength={100} onChange={updateDraft} placeholder={draft.mode === 'artist' ? 'Ex.: van Gogh, Monet, Hokusai' : 'Ex.: paisagem, flores, retrato'}/></div>
      <div><label htmlFor="exhibition-category">Categoria</label><select id="exhibition-category" name="departmentId" value={draft.departmentId} onChange={updateDraft}><option value="">Todas as categorias</option>{departments.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></div>
      <div><label htmlFor="exhibition-medium">Tipo de obra</label><select id="exhibition-medium" name="medium" value={draft.medium} onChange={updateDraft}><option value="">Todos os tipos</option>{media.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
      <div className="exhibition-filter-actions"><button className="button">Buscar</button><button type="button" className="button secondary" onClick={() => setDraft(initialFilters)}>Limpar</button></div>
    </form>
    {error ? <div className="alert error" role="alert">{error} <button className="text-link" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div> : loading ? <>
      <p role="status" className="fine muted">Carregando obras…</p><div className="lot-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="lot-card artwork-skeleton"><div/><span/><span/></div>)}</div>
    </> : <>
      {data?.offline && <p className="alert" role="status">O museu está indisponível. Exibindo somente obras salvas que correspondem aos filtros.</p>}
      {data?.partial && <p className="alert">Algumas obras não puderam ser carregadas. Avance para continuar explorando.</p>}
      {data?.items.length ? <div className="lot-grid">{data.items.map(item => <article className="lot-card" key={item.id}>
        <a className="artwork" href={item.source} target="_blank" rel="noreferrer"><img src={item.imageUrl} alt={`${item.title}, de ${item.artist}`} loading="lazy" decoding="async" onError={event => { if (!event.currentTarget.src.endsWith('/art-placeholder.svg')) event.currentTarget.src = '/art-placeholder.svg'; }}/><span className="badge">Em exposição</span><span className="art-arrow" aria-hidden="true">↗</span></a>
        <div className="card-body"><p className="eyebrow">{item.artist}</p><h3><a href={item.source} target="_blank" rel="noreferrer">{item.title}</a></h3><p className="fine muted">{item.date || 'Data não informada'}{item.medium ? ` · ${item.medium}` : ''}</p><a className="text-link" href={item.source} target="_blank" rel="noreferrer">Ver detalhes no museu ↗</a></div>
      </article>)}</div> : <div className="empty"><h3>Nenhuma obra disponível nesta página</h3><p>Altere os filtros ou avance para encontrar outras obras com imagem pública.</p></div>}
      {data?.searchLimited && <p className="fine muted">A busca do museu permite navegar pelos primeiros 10.000 resultados. Refine os filtros para encontrar outras obras.</p>}
    </>}
    <nav className="exhibition-pagination" aria-label="Páginas do acervo"><button className="button secondary" disabled={loading || page === 1} onClick={() => changePage(page - 1)}>← Anterior</button><span aria-live="polite">Página {page}</span><button className="button secondary" disabled={loading || !!error || !data?.hasNext} onMouseEnter={prefetchNext} onFocus={prefetchNext} onClick={() => changePage(page + 1)}>Próxima →</button></nav>
    <p className="fine muted">Até 6 obras com imagem em domínio público por página. Algumas páginas podem conter menos obras quando há restrições ou indisponibilidade no museu.</p>
  </section>;
}
