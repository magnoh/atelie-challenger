import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { api, post, money, date, go, labels } from './api';
import { ThemeProvider } from './theme/ThemeProvider';
import { ThemeSwitcher } from './theme/ThemeSwitcher';
import './theme/tokens.css';
import './style.css';
const Context = createContext();
const useApp = () => useContext(Context);

function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || '/');
  const [user, setUser] = useState(null), [lots, setLots] = useState([]), [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0), [connected, setConnected] = useState(false), [offset, setOffset] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      const [catalog, balance] = await Promise.all([api('/lots'), me.user ? api('/wallet') : null]);
      setUser(me.user); setLots(catalog.lots); setWallet(balance);
      setOffset(new Date(catalog.serverTime).getTime() - Date.now());
      setRevision(v => v + 1); setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    refresh();
    const onHash = () => setRoute(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHash);
    const stream = new EventSource('/api/events');
    let debounce;
    const update = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 150); };
    stream.addEventListener('ready', () => { setConnected(true); update(); });
    stream.addEventListener('refresh', update);
    stream.onerror = () => setConnected(false);
    const interval = setInterval(refresh, 15000);
    return () => { stream.close(); clearTimeout(debounce); clearInterval(interval); window.removeEventListener('hashchange', onHash); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(t); }, [notice]);
  const value = { user, lots, wallet, refresh, revision, connected, offset, notify: setNotice };
  const parts = route.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'lot') page = <Room id={parts[1]} />;
  else if (parts[0] === 'audit') page = <Audit id={parts[1]} />;
  else if (parts[0] === 'receipt') page = <Receipt id={parts[1]} />;
  else if (parts[0] === 'login') page = <Login />;
  else if (['wallet', 'mine', 'seller'].includes(parts[0]) && !user) page = <Login />;
  else if (parts[0] === 'wallet') page = <Wallet />;
  else if (parts[0] === 'mine') page = <Mine />;
  else if (parts[0] === 'seller') page = user.role === 'auctioneer' ? <Seller /> : <Empty title="Área do leiloeiro" text="Esta página é exclusiva de contas de leiloeiro." />;
  else page = <Showcase />;
  return <Context.Provider value={value}>
    <header className="header"><div className="header-inner"><a className="brand" href="#/" aria-label="Ateliê início"><span className="brand-icon">a.</span>ateliê<span className="brand-sub">CASA DE LEILÕES</span></a>
      <nav aria-label="Menu principal"><a href="#/" className={!parts.length ? 'active' : ''}>Explorar lotes</a>{user?.role === 'bidder' && <a href="#/mine">Meus arremates</a>}{user?.role === 'auctioneer' && <a href="#/seller">Painel do leiloeiro</a>}</nav>
      <div className="account"><ThemeSwitcher />{user ? <><a href="#/wallet" className="wallet-link">{money(wallet?.available)} <span>disponível</span></a><button className="avatar" title={`${user.name} — sair`} aria-label={`Sair da conta de ${user.name}`} onClick={async () => { await post('/auth/logout'); await refresh(); go('/'); }}>{user.name[0].toUpperCase()} ↗</button></> : <a className="button small" href="#/login">Entrar <span>↗</span></a>}</div>
    </div></header>
    <main>{notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Fechar mensagem" onClick={() => setNotice('')}>×</button></div>}
      {error ? <div className="container"><div className="alert error" role="alert">{error} <button onClick={refresh}>Tentar novamente</button></div></div> : null}
      {loading ? <div className="container loading" role="status">Carregando os leilões…</div> : page}
    </main>
    <footer><div className="container footer-inner"><a className="brand" href="#/">ateliê.</a><p>Arte para descobrir. Histórias para continuar.</p><span>Demonstração · Valores e arremates simulados</span></div></footer>
  </Context.Provider>;
}

function Badge({ status }) { return <span className={`badge ${status}`}>{status === 'live' && <i/>}{labels[status] || status}</span>; }
function Image({ item, className = '' }) { return <img className={className} src={item.imageUrl} alt={`${item.title}, de ${item.artist}`} loading="lazy" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = '/art-placeholder.svg'; }} />; }
function Countdown({ lot }) {
  const { offset } = useApp();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (lot.phase === 'closed' || lot.phase === 'cancelled') return <span>{labels[lot.phase]}</span>;
  const target = lot.phase === 'scheduled' ? lot.starts_at : lot.ends_at;
  const seconds = Math.max(0, Math.ceil((new Date(target).getTime() - now - offset) / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24;
  return <span className={seconds < 120 && lot.phase === 'live' ? 'urgent' : ''}>{seconds === 0 ? 'Atualizando…' : `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`}</span>;
}
function LotCard({ lot }) {
  return <article className="lot-card"><a href={`#/lot/${lot.id}`} className="artwork"><Image item={lot.snapshot}/><Badge status={lot.phase}/><span className="art-arrow" aria-hidden="true">↗</span></a>
    <div className="card-body"><p className="eyebrow">{lot.snapshot.artist?.split('(')[0]} <span>· {lot.snapshot.date}</span></p><h3><a href={`#/lot/${lot.id}`}>{lot.title}</a></h3>
      {lot.isLeading && lot.phase === 'live' && <span className="leading-label">Você está ganhando</span>}
      <div className="card-bottom"><div><small>{lot.bid_count ? 'Lance atual' : 'Lance inicial'}</small><strong>{money(lot.current_amount || lot.initial_amount)}</strong></div><div className="right"><small>{lot.phase === 'scheduled' ? 'Começa em' : lot.phase === 'closed' ? `${lot.bid_count} lances` : 'Encerra em'}</small><b className="timer"><Countdown lot={lot}/></b></div></div>
    </div></article>;
}
function Showcase() {
  const { lots, connected } = useApp();
  const [tab, setTab] = useState('live');
  const displayed = lots.filter(l => l.phase === tab);
  const featured = lots.find(l => l.phase === 'live') || lots[0];
  return <div className="container"><section className="hero"><div className="hero-copy"><p className="eyebrow">UMA NOVA FORMA DE COLECIONAR</p><h1>O próximo capítulo<br/>da arte começa <em>com você.</em></h1><p>Descubra obras, acompanhe cada lance e encontre<br className="desktop"/> uma história para fazer parte da sua coleção.</p><a href="#exhibition" onClick={e => { e.preventDefault(); document.getElementById('exhibition').scrollIntoView({ behavior: 'smooth' }); }} className="button">Explorar o acervo <span>↓</span></a><div className="hero-note"><span className="seal-icon">✓</span> Cada lance tem um histórico público e verificável.</div></div>
      {featured && <a className="hero-art" href={`#/lot/${featured.id}`}><Image item={featured.snapshot}/><span className="hero-art-caption"><span>EM DESTAQUE<br/><strong>{featured.snapshot.artist?.split('(')[0]}</strong></span><span>Conhecer a obra ↗</span></span></a>}
    </section>
    <div className="trust-strip"><span>◉ <b>Descubra</b> obras do acervo público</span><span>↗ <b>Participe</b> com lances ao vivo</span><span>✓ <b>Confira</b> o histórico de cada lance</span></div>
    <Exhibition />
    <section id="lots" className="catalog-section"><div className="section-heading"><div><p className="eyebrow">ESCOLHA SUA PRÓXIMA DESCOBERTA</p><h2>Em leilão</h2></div><span className="connection"><i className={connected ? 'online' : ''}/>{connected ? 'Atualizações ao vivo' : 'Atualizando a cada 15s'}</span></div>
      <div className="tabs" role="tablist" aria-label="Situação dos lotes">{['live', 'scheduled', 'closed'].map(status => <button key={status} role="tab" aria-selected={tab === status} className={tab === status ? 'selected' : ''} onClick={() => setTab(status)}>{status === 'live' ? 'Ao vivo' : status === 'scheduled' ? 'Agendados' : 'Encerrados'}<span>{lots.filter(l => l.phase === status).length}</span></button>)}</div>
      {displayed.length ? <div className="lot-grid">{displayed.map(lot => <LotCard key={lot.id} lot={lot}/>)}</div> : <Empty title="Nenhum lote por aqui" text="Os próximos leilões aparecerão nesta seção."/>}
    </section><div className="source-note">Obras e informações do <a href="https://metmuseum.github.io/" target="_blank" rel="noreferrer">The Metropolitan Museum of Art ↗</a>. Esta é uma plataforma demonstrativa, sem venda de obras reais.</div>
  </div>;
}
function Exhibition() {
  const [query, setQuery] = useState(''), [term, setTerm] = useState(''), [page, setPage] = useState(1);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`/exhibition?${new URLSearchParams({ q: term, page: String(page) })}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [term, page, retry]);
  const changePage = next => { setPage(next); document.getElementById('exhibition').scrollIntoView({ behavior: 'smooth' }); };
  return <section id="exhibition" className="catalog-section exhibition-section" aria-busy={loading}>
    <div className="section-heading"><div><p className="eyebrow">THE METROPOLITAN MUSEUM OF ART</p><h2>Acervo em exposição</h2></div><a className="text-link" href="#lots" onClick={e => { e.preventDefault(); document.getElementById('lots').scrollIntoView({ behavior: 'smooth' }); }}>Ver lotes em leilão ↓</a></div>
    <p className="muted exhibition-intro">Explore o acervo do museu por páginas ou busque uma obra ou artista. Aqui exibimos as obras com imagens em domínio público; os lotes para dar lances estão na seção de leilões.</p>
    <form className="search-form" onSubmit={e => { e.preventDefault(); setPage(1); setTerm(query.trim()); setRetry(v => v + 1); }}><label className="sr-only" htmlFor="exhibition-query">Buscar obras ou artistas no museu</label><input id="exhibition-query" placeholder="Busque por obra ou artista, ex.: van Gogh" value={query} maxLength={100} onChange={e => setQuery(e.target.value)}/><button className="button" disabled={loading}>Buscar no acervo</button>{term && <button type="button" className="button secondary" disabled={loading} onClick={() => { setQuery(''); setTerm(''); setPage(1); }}>Todo o acervo</button>}</form>
    {error ? <div className="alert error" role="alert">{error} <button className="text-link" onClick={() => setRetry(v => v + 1)}>Tentar novamente</button></div> : loading ? <div className="loading" role="status">Consultando as obras do Metropolitan…</div> : <>
      {data?.offline && <p className="alert" role="status">O museu está indisponível no momento. Exibindo obras do catálogo salvo.</p>}
      {data?.partial && <p className="alert">Algumas obras não puderam ser carregadas nesta página. Você pode continuar navegando.</p>}
      {data?.items.length ? <div className="lot-grid">{data.items.map(item => <article className="lot-card" key={item.id}><a className="artwork" href={item.source} target="_blank" rel="noreferrer"><Image item={item}/><span className="badge">Em exposição</span><span className="art-arrow" aria-hidden="true">↗</span></a><div className="card-body"><p className="eyebrow">{item.artist}</p><h3><a href={item.source} target="_blank" rel="noreferrer">{item.title}</a></h3><p className="fine muted">{item.date || 'Data não informada'}{item.medium ? ` · ${item.medium}` : ''}</p><a className="text-link" href={item.source} target="_blank" rel="noreferrer">Ver detalhes no museu ↗</a></div></article>)}</div> : <Empty title="Nenhuma imagem pública nesta página" text="Avance para outra página ou tente buscar por uma obra ou artista."/>}
      {data?.searchLimited && <p className="fine muted">A busca do museu permite acessar os primeiros 10.000 resultados. Use um termo mais específico para explorar outros resultados.</p>}
      <nav className="exhibition-pagination" aria-label="Páginas do acervo"><button className="button secondary" disabled={page === 1} onClick={() => changePage(page - 1)}>← Anterior</button><span aria-live="polite">Página {page}{data?.reachable ? ` de ${Math.ceil(data.reachable / data.pageSize).toLocaleString('pt-BR')}` : ''}</span><button className="button secondary" disabled={!data?.hasNext} onClick={() => changePage(page + 1)}>Próxima →</button></nav>
      <p className="fine muted">Cada página consulta até 24 registros do museu e exibe os que possuem imagem pública. A quantidade de obras visíveis pode variar.</p>
    </>}
  </section>;
}
function Empty({ title, text }) { return <div className="empty"><span aria-hidden="true">◇</span><h3>{title}</h3><p>{text}</p></div>; }
function PageTitle({ eyebrow, title, children }) { return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</div>; }
function useResource(path) {
  const { revision } = useApp();
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; api(path).then(result => { if (active) { setData(result); setError(''); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [path, revision]);
  return [data, error];
}
function ResourceState({ error }) { return <div className="container"><div className={error ? 'alert error' : 'loading'} role={error ? 'alert' : 'status'}>{error || 'Carregando…'}</div></div>; }
function Room({ id }) {
  const { user, wallet, refresh, notify, connected } = useApp();
  const [data, error] = useResource(`/lots/${id}`);
  const [amount, setAmount] = useState(''), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const lot = data?.lot;
  useEffect(() => { if (lot) setAmount((lot.minimumBid / 100).toFixed(2)); }, [id, lot?.minimumBid]);
  if (!data || error) return <ResourceState error={error}/>;
  const bid = async e => {
    e.preventDefault(); setBusy(true); setFeedback('');
    try { const result = await post(`/lots/${id}/bids`, { amount: Math.round(Number(amount) * 100) }); notify(result.message); await refresh(); }
    catch (e) { setFeedback(e.message); await refresh(); }
    finally { setBusy(false); }
  };
  return <div className="container"><a href="#/" className="back">← Voltar para os lotes</a><div className="room-grid"><div><div className="room-image"><Image item={lot.snapshot}/></div><div className="item-description"><p className="eyebrow">SOBRE A OBRA</p><h2>{lot.snapshot.artist?.split('(')[0]}</h2><dl><div><dt>Obra</dt><dd>{lot.snapshot.title}</dd></div><div><dt>Data</dt><dd>{lot.snapshot.date}</dd></div><div><dt>Técnica</dt><dd>{lot.snapshot.medium}</dd></div><div><dt>Dimensões</dt><dd>{lot.snapshot.dimensions}</dd></div></dl><a className="text-link" href={lot.snapshot.source} target="_blank" rel="noreferrer">Ver no acervo original ↗</a></div></div>
    <aside className="room-panel"><div className="panel-top"><Badge status={lot.phase}/><span className="muted">{connected ? '● Ao vivo' : 'Reconectando…'}</span></div><h1>{lot.title}</h1><p className="muted">{lot.snapshot.artist}</p><div className="current-price"><small>{lot.bid_count ? 'Lance atual' : 'Lance inicial'}</small><strong>{money(lot.current_amount || lot.initial_amount)}</strong><span>{lot.bid_count} {lot.bid_count === 1 ? 'lance' : 'lances'} · Incremento de {money(lot.increment)}</span></div>
      <div className="countdown-box"><span>{lot.phase === 'scheduled' ? 'Começa em' : 'Tempo restante'}</span><strong><Countdown lot={lot}/></strong></div><p className="muted fine">Início: {date(lot.starts_at)}<br/>Fim: {date(lot.ends_at)}</p>
      {!data.integrity && <div className="alert error">Histórico com divergências. Novos lances e liquidação estão bloqueados.</div>}
      {lot.phase === 'live' && user?.role === 'bidder' && <><div className={`position ${lot.isLeading ? 'winning' : ''}`}>{lot.isLeading ? '✓ Você está ganhando este lote.' : data.bids.some(b => b.bidder === user.alias) ? 'Você foi superado. Dê um novo lance.' : 'Seu próximo lance pode começar uma nova história.'}</div><form onSubmit={bid}><label htmlFor="bid-amount">Seu lance (R$)</label><div className="bid-input"><input id="bid-amount" type="number" step="0.01" min={lot.minimumBid / 100} value={amount} onChange={e => setAmount(e.target.value)} required disabled={lot.isLeading || busy}/><button type="button" aria-label="Adicionar incremento mínimo" onClick={() => setAmount((Number(amount) + lot.increment / 100).toFixed(2))} disabled={lot.isLeading || busy}>+</button></div><p className="fine muted">Mínimo: {money(lot.minimumBid)} · Disponível: {money(wallet?.available)}</p><button className="button full" disabled={busy || lot.isLeading || !data.integrity}>{busy ? 'Enviando…' : lot.isLeading ? 'Você está ganhando' : 'Confirmar lance ↗'}</button></form></>}
      {lot.phase === 'live' && !user && <a className="button full" href="#/login">Entre para dar um lance ↗</a>}
      {user?.role === 'auctioneer' && <p className="alert">Leiloeiros não podem dar lances.</p>}
      {lot.phase === 'scheduled' && <p className="alert">Aguarde o horário de início para participar.</p>}
      {lot.phase === 'closed' && <div className="alert">{lot.leader_alias ? `Arrematado por ${lot.leader_alias}.` : 'Encerrado sem arrematante.'}{lot.receipt_id && <a className="text-link block" href={`#/receipt/${lot.receipt_id}`}>Ver comprovante público ↗</a>}</div>}
      {feedback && <p className="alert error" role="alert">{feedback}</p>}
      <p className="fine muted">Lances nos últimos 2 minutos prorrogam o encerramento para 2 minutos após o lance.</p><a className="audit-link" href={`#/audit/${id}`}>✓ Consultar auditoria pública <span>↗</span></a>
    </aside></div><section className="history"><div className="section-heading"><h2>Histórico de lances</h2><span className="muted">Identidades protegidas</span></div><BidTable bids={data.bids}/></section></div>;
}
function BidTable({ bids, hashes = false }) {
  if (!bids.length) return <Empty title="Nenhum lance registrado" text="O primeiro lance pode ser o seu."/>;
  return <div className="table-wrap"><table><thead><tr><th>#</th><th>Licitante</th><th>Valor</th><th>Data e hora</th>{hashes && <th>Hash SHA-256</th>}</tr></thead><tbody>{[...bids].reverse().map(b => <tr key={b.id}><td>{b.sequence}</td><td>{b.bidder}</td><td><b>{money(b.amount)}</b></td><td>{date(b.placedAt)}</td>{hashes && <td><code title={b.hash}>{b.hash.slice(0, 16)}…</code></td>}</tr>)}</tbody></table></div>;
}
function Login() {
  const { refresh, notify, user } = useApp();
  const [register, setRegister] = useState(false), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError(''); const form = new FormData(e.currentTarget);
    try { await post(`/auth/${register ? 'register' : 'login'}`, { email, password, ...(register ? { name: form.get('name'), role: form.get('role') } : {}) }); await refresh(); notify(register ? 'Conta criada. Bem-vindo ao Ateliê!' : 'Você entrou na sua conta.'); go('/'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (user) return <div className="container"><Empty title={`Olá, ${user.name}`} text="Você já está conectado."/><a className="button" href="#/">Explorar lotes</a></div>;
  return <div className="container auth-layout"><div className="auth-intro"><p className="eyebrow">SUA PRÓXIMA DESCOBERTA</p><h1>Uma coleção<br/>começa com<br/><em>um encontro.</em></h1><p>Entre para acompanhar os leilões e participar<br/>com a sua carteira de demonstração.</p></div><div className="form-panel"><h2>{register ? 'Crie sua conta' : 'Bem-vindo de volta'}</h2><p className="muted">{register ? 'Escolha como você quer participar.' : 'Entre para continuar sua coleção.'}</p><form onSubmit={submit}>{register && <><label htmlFor="name">Nome</label><input id="name" name="name" required minLength={2} maxLength={80} autoComplete="name"/><label htmlFor="role">Perfil</label><select id="role" name="role"><option value="bidder">Licitante — participar dos leilões</option><option value="auctioneer">Leiloeiro — criar e gerenciar lotes</option></select></>}<label htmlFor="email">E-mail</label><input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required/><label htmlFor="password">Senha</label><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} required/><p className="fine muted">Mínimo de 10 caracteres.</p>{error && <div role="alert" className="alert error">{error}</div>}<button className="button full" disabled={busy}>{busy ? 'Aguarde…' : register ? 'Criar conta ↗' : 'Entrar ↗'}</button></form><button className="text-link auth-switch" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Já tenho uma conta' : 'Ainda não tem conta? Cadastre-se'}</button><div className="demo-accounts"><p className="eyebrow">CONTAS PARA AVALIAÇÃO</p><p className="fine">Senha padrão: <code>Verzel2026!</code></p><div>{[['ana@demo.com', 'Ana · Licitante'], ['bruno@demo.com', 'Bruno · Licitante'], ['leiloeiro@demo.com', 'Leiloeiro']].map(([mail, label]) => <button key={mail} className="chip" onClick={() => { setRegister(false); setEmail(mail); setPassword('Verzel2026!'); }}>{label}</button>)}</div></div></div></div>;
}
function Wallet() {
  const { wallet, user, refresh, notify } = useApp();
  const [amount, setAmount] = useState('1000'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async e => { e.preventDefault(); setBusy(true); setError(''); try { const result = await post('/wallet/deposit', { amount: Math.round(Number(amount) * 100) }); notify(result.message); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <div className="container"><PageTitle eyebrow="SUA CONTA" title="Minha carteira"><p>Gerencie seu saldo e acompanhe as movimentações.</p></PageTitle><div className="balance-grid">{[['Saldo total', wallet?.total], ['Saldo comprometido', wallet?.reserved], ['Saldo disponível', wallet?.available]].map(([label, value]) => <div className="balance-card" key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div><div className="wallet-grid"><section className="form-panel"><h2>{user.role === 'bidder' ? 'Adicionar saldo' : 'Recebimentos'}</h2>{user.role === 'bidder' ? <><p className="muted">Depósito simulado, sem cobrança real.</p><form onSubmit={submit}><label htmlFor="deposit">Valor (R$)</label><input id="deposit" type="number" min="0.01" step="0.01" max="1000000000" required value={amount} onChange={e => setAmount(e.target.value)}/><div className="quick-values">{[100, 500, 1000, 5000].map(v => <button className="chip" type="button" key={v} onClick={() => setAmount(String(v))}>{money(v * 100)}</button>)}</div>{error && <p className="alert error" role="alert">{error}</p>}<button className="button full" disabled={busy}>{busy ? 'Depositando…' : 'Confirmar depósito'}</button></form></> : <p>O valor de cada lote arrematado é creditado aqui automaticamente no encerramento.</p>}<p className="fine muted">Ao liderar um lote, seu lance fica comprometido. Se você for superado, o valor volta a ficar disponível.</p></section><section><h2>Últimas movimentações</h2>{wallet?.entries?.length ? <ul className="ledger">{wallet.entries.map(e => <li key={e.id}><span><b>{{ deposit: 'Depósito simulado', sale: 'Lote arrematado · recebimento', purchase: 'Arremate · pagamento' }[e.kind]}</b><small>{date(e.created_at)}</small></span><strong className={e.amount > 0 ? 'positive' : ''}>{e.amount > 0 ? '+' : ''}{money(e.amount)}</strong></li>)}</ul> : <Empty title="Nenhuma movimentação" text="As movimentações aparecerão aqui."/>}</section></div></div>;
}
function Mine() {
  const { lots } = useApp();
  const involved = lots.filter(l => l.participated);
  return <div className="container"><PageTitle eyebrow="SUA COLEÇÃO" title="Meus arremates"><p>Os lotes em que você participou, seus resultados e comprovantes.</p></PageTitle>{involved.length ? <div className="lot-grid">{involved.map(lot => <div key={lot.id}><LotCard lot={lot}/><div className="result-line">{lot.phase === 'closed' ? lot.isLeading ? <><span className="positive">✓ Você arrematou</span>{lot.receipt_id && <a href={`#/receipt/${lot.receipt_id}`}>Comprovante ↗</a>}</> : 'Encerrado · outro licitante arrematou' : lot.isLeading ? 'Você está ganhando' : 'Você foi superado'}</div></div>)}</div> : <Empty title="Sua coleção começa aqui" text="Participe de um leilão para acompanhar seus lances nesta página."/>}</div>;
}
function Seller() {
  const { revision, refresh, notify } = useApp();
  const [lots, setLots] = useState([]), [items, setItems] = useState([]), [query, setQuery] = useState(''), [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false), [searching, setSearching] = useState(false), [error, setError] = useState(''), [offline, setOffline] = useState(false), [source, setSource] = useState('saved');
  useEffect(() => { let active = true; api('/lots?own=true').then(r => { if (active) setLots(r.lots); }).catch(e => setError(e.message)); return () => { active = false; }; }, [revision]);
  const search = async e => { e?.preventDefault(); setSearching(true); setError(''); try { const result = await api(`/catalog?q=${encodeURIComponent(query)}`); setItems(result.items); setOffline(result.offline); setSource(result.source); } catch (e) { setError(e.message); } finally { setSearching(false); } };
  useEffect(() => { search(); }, []);
  const create = async e => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(''); try {
    await post('/lots', { itemId: selected.id, title: f.get('title'), initialAmount: Math.round(Number(f.get('initial')) * 100), increment: Math.round(Number(f.get('increment')) * 100), startsAt: new Date(f.get('start')).toISOString(), endsAt: new Date(f.get('end')).toISOString() });
    notify('Lote publicado. Ele já está na vitrine.'); setSelected(null); await refresh();
  } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const cancel = async id => { setBusy(true); setError(''); try { await post(`/lots/${id}/cancel`); notify('Lote cancelado.'); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const localDate = (offset = 0) => { const d = new Date(Date.now() + offset); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  return <div className="container"><PageTitle eyebrow="ÁREA DO LEILOEIRO" title="Seus leilões"><p>Busque uma obra no acervo público e publique um lote.</p></PageTitle><div className="seller-summary"><span><b>{lots.length}</b> lotes criados</span><span><b>{lots.filter(l => l.phase === 'live').length}</b> ao vivo</span><span>Total recebido <b>{money(lots.filter(l => l.status === 'closed' && l.current_amount).reduce((sum, l) => sum + l.current_amount, 0))}</b></span></div>
    <section className="form-panel seller-create"><h2>Criar um lote</h2><form className="search-form" onSubmit={search}><label className="sr-only" htmlFor="catalog-search">Buscar obra ou artista</label><input id="catalog-search" placeholder="Busque uma obra ou artista, ex.: Monet" value={query} onChange={e => setQuery(e.target.value)} maxLength={100}/><button className="button" disabled={searching}>{searching ? 'Buscando…' : 'Buscar no acervo'}</button></form>{offline && <p className="alert">API indisponível. Exibindo o catálogo salvo, que continua disponível para novos lotes.</p>}
      {!searching && !offline && <p className="fine muted" role="status">{source === 'metropolitan' ? 'Busca realizada na API do Metropolitan Museum. Exibindo obras com imagem em domínio público.' : 'Catálogo salvo do Metropolitan Museum. Digite uma obra ou artista e clique em “Buscar no acervo” para consultar a API.'}</p>}
      {!searching && !items.length && <p className="muted">Nenhuma obra com imagem em domínio público encontrada. Tente “van Gogh” ou “Hokusai”.</p>}
      <div className="catalog-picks">{items.map(item => <button key={item.id} type="button" className={`catalog-pick ${selected?.id === item.id ? 'picked' : ''}`} onClick={() => { setSelected(item); setError(''); }}><Image item={item}/><span><b>{item.title}</b><small>{item.artist}</small></span><span>{selected?.id === item.id ? '✓' : '+'}</span></button>)}</div>
      {selected && <form onSubmit={create} className="create-form" key={selected.id}><div className="form-wide"><label htmlFor="lot-title">Título do lote</label><input id="lot-title" name="title" defaultValue={selected.title} required minLength={2} maxLength={200}/></div><div><label htmlFor="lot-initial">Lance inicial (R$)</label><input id="lot-initial" name="initial" type="number" min="0.01" step="0.01" defaultValue="100" required/></div><div><label htmlFor="lot-increment">Incremento mínimo (R$)</label><input id="lot-increment" name="increment" type="number" min="0.01" step="0.01" defaultValue="10" required/></div><div><label htmlFor="lot-start">Início</label><input id="lot-start" name="start" type="datetime-local" defaultValue={localDate()} required/></div><div><label htmlFor="lot-end">Fim</label><input id="lot-end" name="end" type="datetime-local" defaultValue={localDate(3600_000)} required/></div><button className="button form-wide" disabled={busy}>{busy ? 'Publicando…' : 'Publicar lote ↗'}</button></form>}
      {error && <p role="alert" className="alert error">{error}</p>}
    </section><section className="history"><h2>Lotes publicados</h2>{lots.length ? <div className="table-wrap"><table><thead><tr><th>Obra</th><th>Situação</th><th>Lances</th><th>Valor</th><th>Resultado</th><th>Ações</th></tr></thead><tbody>{lots.map(lot => <tr key={lot.id}><td><a href={`#/lot/${lot.id}`}>{lot.title}</a></td><td><Badge status={lot.phase}/></td><td>{lot.bid_count}</td><td>{money(lot.current_amount || lot.initial_amount)}</td><td>{lot.status === 'closed' ? lot.leader_alias || 'Sem arrematante' : '—'}</td><td>{lot.status === 'open' && lot.phase !== 'closed' && !lot.bid_count ? <button className="text-link danger" disabled={busy} onClick={() => cancel(lot.id)}>Cancelar lote</button> : lot.receipt_id ? <a href={`#/receipt/${lot.receipt_id}`}>Comprovante ↗</a> : '—'}</td></tr>)}</tbody></table></div> : <Empty title="Seu primeiro leilão" text="Escolha uma obra acima para publicar seu primeiro lote."/>}</section>
  </div>;
}
function Audit({ id }) {
  const [data, error] = useResource(`/lots/${id}/audit`);
  const { refresh } = useApp();
  if (!data || error) return <ResourceState error={error}/>;
  return <div className="container"><a className="back" href={`#/lot/${id}`}>← Voltar ao lote</a><PageTitle eyebrow="TRANSPARÊNCIA EM CADA LANCE" title="Auditoria pública"><p>{data.title}</p></PageTitle><div className={`audit-result ${data.valid ? '' : 'invalid'}`}><span className="audit-check">{data.valid ? '✓' : '!'}</span><div><h2>{data.valid ? 'Histórico íntegro' : 'Alteração detectada'}</h2><p>{data.valid ? `${data.count} lances verificados. Nenhuma divergência encontrada.` : 'O histórico não corresponde aos registros assinados. O lote exige revisão.'}</p><small>Verificado em {date(data.verifiedAt)}</small></div><button className="button secondary" onClick={refresh}>Verificar novamente</button></div>{data.problems.length > 0 && <ul className="alert error">{data.problems.map(p => <li key={p}>{p}</li>)}</ul>}<div className="audit-explainer"><h3>Como verificamos?</h3><p>Cada lance inclui o hash do anterior. Recalculamos toda a sequência e verificamos a assinatura do lote usando uma chave mantida fora do banco de dados. Assim, alterações, exclusões e inserções no histórico geram divergências.</p><p className="fine muted">Método: {data.algorithm}. A verificação é feita pelo servidor da plataforma. Licitantes são identificados por apelidos, sem nome ou e-mail.</p><label>Raiz do histórico</label><code className="hash">{data.head}</code></div><section className="history"><h2>Todos os lances</h2><BidTable bids={data.bids} hashes/></section></div>;
}
function Receipt({ id }) {
  const [data, error] = useResource(`/receipts/${id}`);
  const { notify } = useApp();
  if (!data || error) return <ResourceState error={error}/>;
  const share = async () => { try { await navigator.clipboard.writeText(location.href); notify('Link público copiado.'); } catch { notify('Copie o endereço desta página para compartilhar.'); } };
  return <div className="container receipt-container"><div className="receipt-actions"><a className="back" href="#/mine">← Meus arremates</a><button className="button secondary" onClick={share}>Copiar link público ↗</button></div><article className="receipt"><div className="receipt-heading"><span className="brand">ateliê.</span><span className={`badge ${data.valid ? 'live' : 'cancelled'}`}>{data.valid ? '✓ Assinatura válida' : 'Assinatura inválida'}</span></div><p className="eyebrow">COMPROVANTE DE ARREMATE</p><h1>Uma nova história<br/>para sua coleção.</h1><Image item={data.item}/><h2>{data.title}</h2><p className="muted">{data.item.artist}</p><dl><div><dt>Arrematante</dt><dd>{data.winner}</dd></div><div><dt>Valor do arremate</dt><dd><strong>{money(data.amount)}</strong></dd></div><div><dt>Emitido em</dt><dd>{date(data.issuedAt)}</dd></div><div><dt>Lances registrados</dt><dd>{data.bidCount}</dd></div><div><dt>Identificador</dt><dd className="hash">{data.id}</dd></div></dl><a className="audit-link" href={`#/audit/${data.lotId}`}>Consultar o histórico completo <span>↗</span></a><p className="fine muted">Comprovante demonstrativo. Não representa a venda ou transferência de uma obra real. Esta página é pública e não contém dados pessoais do arrematante.</p></article></div>;
}
createRoot(document.getElementById('root')).render(<ThemeProvider><App/></ThemeProvider>);

