import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { pool, transaction } from './db.mjs';
import { config } from './config.mjs';
import { AppError, ensure, cents, digest, hashPassword, verifyPassword, equal, sign } from './domain.mjs';
import { settleDue, wallet, mutate, createLot, placeBid, cancelLot, listLots, publicLot, auditLot, bidderPosition } from './service.mjs';
import { searchCatalog, browseCatalog, getItem, cacheImage } from './catalog.mjs';
import { departments, media } from '../shared/exhibition-options.js';
const uuid = z.uuid();
const amountSchema = z.object({ amount: z.number().int().positive().max(100_000_000_000) }).strict();
const credentials = z.object({ email: z.email().max(254).transform(s => s.toLowerCase()), password: z.string().min(10).max(128) });
const registration = credentials.extend({ name: z.string().trim().min(2).max(80), role: z.enum(['auctioneer', 'bidder']) }).strict();
const lotInput = z.object({ itemId: z.number().int().positive(), title: z.string().trim().min(2).max(200).optional(),
  initialAmount: z.number().int().positive(), increment: z.number().int().positive(), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }) }).strict();
const limits = new Map();
function rate(req, category, max, window = 60_000) {
  const key = `${category}:${req.ip}`;
  const now = Date.now();
  let entry = limits.get(key);
  if (!entry || entry.until <= now) { entry = { count: 0, until: now + window }; limits.set(key, entry); }
  ensure(++entry.count <= max, 'Muitas tentativas. Aguarde um minuto.', 429, 'RATE_LIMIT');
  if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
}
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://images.metmuseum.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      try {
        const origin = req.get('origin');
        ensure(!origin || origin === config.origin || new URL(origin).host === req.get('host'), 'Origem não autorizada.', 403);
        ensure(req.is('application/json'), 'Use Content-Type: application/json.', 415);
      } catch (error) { return next(error); }
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', async (req, res, next) => {
    try {
      const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('session='))?.slice(8);
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        const { rows } = await pool.query('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [digest(token)]);
        req.user = rows[0];
      }
      next();
    } catch (error) { next(error); }
  });
  const auth = role => (req, res, next) => {
    try { ensure(req.user, 'Entre na sua conta para continuar.', 401, 'UNAUTHENTICATED'); ensure(!role || req.user.role === role, 'Seu perfil não permite esta ação.', 403, 'ROLE_FORBIDDEN'); next(); }
    catch (error) { next(error); }
  };
  const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, alias: u.alias });
  const session = async (res, user) => {
    const token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'7 days\')', [digest(token), user.id]);
    res.cookie('session', token, { httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: 7 * 86400_000, path: '/' });
  };
  app.get('/api/health', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  app.post('/api/auth/register', async (req, res) => {
    rate(req, 'register', 10);
    const input = registration.parse(req.body);
    const user = { id: randomUUID(), alias: `Colecionador-${randomBytes(4).toString('hex').toUpperCase()}`, ...input };
    const password = await hashPassword(input.password);
    try { await pool.query('INSERT INTO users(id,email,name,password_hash,role,alias) VALUES($1,$2,$3,$4,$5,$6)', [user.id, user.email, user.name, password, user.role, user.alias]); }
    catch (e) { if (e.code === '23505') throw new AppError('Este e-mail já possui uma conta.', 409); throw e; }
    await session(res, user);
    res.status(201).json({ user: safeUser(user) });
  });
  app.post('/api/auth/login', async (req, res) => {
    rate(req, 'login', 20);
    const input = credentials.parse(req.body);
    const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email=$1', [input.email]);
    // Perform a comparable expensive operation for unknown accounts as well.
    const valid = user ? await verifyPassword(input.password, user.password_hash) : (await hashPassword(input.password), false);
    ensure(valid, 'E-mail ou senha inválidos.', 401);
    await session(res, user);
    res.json({ user: safeUser(user) });
  });
  app.post('/api/auth/logout', async (req, res) => {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('session='))?.slice(8);
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
    res.clearCookie('session', { path: '/', httpOnly: true, secure: config.production, sameSite: 'strict' });
    res.json({ ok: true });
  });
  app.get('/api/auth/me', async (req, res) => res.json({ user: req.user ? safeUser(req.user) : null, serverTime: new Date().toISOString() }));
  app.get('/api/lots', async (req, res) => {
    const own = req.query.own === 'true';
    if (own) { ensure(req.user?.role === 'auctioneer', 'Acesso exclusivo do leiloeiro.', 403); }
    const data = await transaction(async client => { await settleDue(client); return listLots(client, req.user, own); }, { notify: false });
    res.json({ lots: data, serverTime: new Date().toISOString() });
  });
  app.get('/api/lots/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const data = await transaction(async client => {
      await settleDue(client);
      const { rows: [lot] } = await client.query('SELECT l.*,u.alias AS leader_alias,r.id AS receipt_id FROM lots l LEFT JOIN users u ON u.id=l.leader_id LEFT JOIN receipts r ON r.lot_id=l.id WHERE l.id=$1', [id]);
      ensure(lot && (lot.status !== 'cancelled' || lot.seller_id === req.user?.id), 'Lote não encontrado.', 404);
      const integrity = await auditLot(client, lot);
      const position = integrity.valid ? await bidderPosition(client, id, req.user) : null;
      return { lot: { ...publicLot(lot, req.user), position }, bids: integrity.bids, integrity: integrity.valid };
    }, { notify: false });
    res.json({ ...data, serverTime: new Date().toISOString() });
  });
  app.get('/api/lots/:id/audit', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const data = await transaction(async client => {
      const { rows: [lot] } = await client.query('SELECT * FROM lots WHERE id=$1', [id]);
      ensure(lot, 'Lote não encontrado.', 404);
      return { lotId: id, title: lot.title, item: lot.snapshot, ...await auditLot(client, lot) };
    }, { notify: false });
    res.json(data);
  });
  app.post('/api/lots', auth('auctioneer'), async (req, res) => {
    rate(req, 'create-lot', 20);
    const input = lotInput.parse(req.body);
    const item = await getItem(input.itemId);
    // Materialize the image before publishing. Existing cached images also work offline.
    const { rows: [record] } = await pool.query('SELECT image IS NOT NULL AS saved FROM catalog WHERE id=$1', [item.id]);
    if (!record.saved) ensure(await cacheImage(item), 'A imagem ainda não foi salva. Aguarde a API retornar ou selecione uma obra com imagem salva.', 503);
    const result = await mutate(async client => ({ id: (await createLot(client, req.user.id, input, item)).id }));
    res.status(201).json(result);
  });
  app.post('/api/lots/:id/bids', auth('bidder'), async (req, res) => {
    rate(req, 'bids', 60);
    const id = uuid.parse(req.params.id);
    const { amount } = amountSchema.parse(req.body);
    const result = await mutate(client => placeBid(client, id, req.user, amount));
    res.status(201).json(result);
  });
  app.post('/api/lots/:id/cancel', auth('auctioneer'), async (req, res) => {
    const id = uuid.parse(req.params.id);
    res.json(await mutate(client => cancelLot(client, id, req.user.id)));
  });
  app.get('/api/wallet', auth(), async (req, res) => {
    res.json(await transaction(async client => {
      await settleDue(client);
      const { rows: entries } = await client.query('SELECT id,lot_id,kind,amount,created_at FROM ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
      return { ...await wallet(client, req.user.id), entries };
    }, { notify: false }));
  });
  app.post('/api/wallet/deposit', auth('bidder'), async (req, res) => {
    rate(req, 'deposit', 30);
    const { amount } = amountSchema.parse(req.body);
    res.json(await mutate(async client => {
      cents(amount);
      const { rows: [user] } = await client.query('SELECT balance FROM users WHERE id=$1', [req.user.id]);
      ensure(user.balance + amount <= 100_000_000_000, 'Saldo máximo de demonstração atingido.');
      await client.query('UPDATE users SET balance=balance+$2 WHERE id=$1', [req.user.id, amount]);
      await client.query("INSERT INTO ledger(id,user_id,kind,amount) VALUES($1,$2,'deposit',$3)", [randomUUID(), req.user.id, amount]);
      return { ...await wallet(client, req.user.id), message: 'Depósito simulado realizado.' };
    }));
  });
  app.get('/api/receipts/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { rows: [receipt] } = await pool.query('SELECT * FROM receipts WHERE id=$1', [id]);
    ensure(receipt, 'Comprovante não encontrado.', 404);
    res.json({ id, ...receipt.payload, signature: receipt.signature, valid: equal(sign({ id, ...receipt.payload }, config.secret), receipt.signature) });
  });
  app.get('/api/exhibition', async (req, res) => {
    rate(req, 'exhibition', 60);
    const query = z.object({
      q: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).max(200000).default(1),
      offset: z.coerce.number().int().min(0).max(2000000).optional(),
      mode: z.enum(['all', 'title', 'artist']).default('all'),
      departmentId: z.string().refine(value => !value || departments.some(d => String(d.id) === value)).default(''),
      medium: z.string().refine(value => !value || media.some(m => m.value === value)).default(''),
    }).parse(req.query);
    res.json(await browseCatalog(query.q, query.page, query));
  });
  app.get('/api/catalog', auth('auctioneer'), async (req, res) => { rate(req, 'catalog', 20); res.json(await searchCatalog(String(req.query.q || ''))); });
  app.get('/api/catalog/:id/image', async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { rows: [item] } = await pool.query('SELECT image,image_type FROM catalog WHERE id=$1', [id]);
    if (!item?.image) return res.type('svg').send(readFileSync(resolve('public/art-placeholder.svg')));
    res.set('Cache-Control', 'public, max-age=86400').type(item.image_type).send(item.image);
  });
  app.get('/api/events', (req, res) => {
    const ipCount = [...app.locals.streams.values()].filter(v => v.ip === req.ip).length;
    if (ipCount >= 15 || app.locals.streams.size >= 1000) return res.status(429).json({ message: 'Limite de conexões ao vivo atingido.' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\nevent: ready\ndata: {}\n\n');
    const id = randomUUID();
    app.locals.streams.set(id, { res, ip: req.ip });
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { clearInterval(timer); app.locals.streams.delete(id); });
  });
  app.locals.streams = new Map();
  app.locals.broadcast = () => { for (const { res } of app.locals.streams.values()) res.write('event: refresh\ndata: {}\n\n'); };
  app.use('/api', (req, res) => res.status(404).json({ message: 'Rota não encontrada.' }));
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist'), { index: false }));
    app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Dados inválidos. Verifique os campos informados.', fields: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON inválido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Requisição muito grande.' });
    if (!(err instanceof AppError)) console.error(err);
    res.status(err.status || 500).json({ message: err instanceof AppError ? err.message : 'Erro interno. Tente novamente.', code: err.code || 'INTERNAL_ERROR' });
  });
  return app;
}
