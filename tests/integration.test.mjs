import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { config } from '../server/config.mjs';
import { pool, transaction } from '../server/db.mjs';
import { createLot, seal, wallet, settleDue } from '../server/service.mjs';
import { ensureDemoLot } from '../server/demo.mjs';
const schema = `test_${randomUUID().replaceAll('-', '')}`;
let admin, server, base, seller, ana, bruno;
async function request(path, method = 'GET', body, session) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function account(name, role) {
  const result = await request('/auth/register', 'POST', { name, role, email: `${name}@test.com`, password: 'Password123!' });
  assert.equal(result.status, 201);
  return { ...result.data.user, cookie: result.cookie };
}
const item = { id: 1, title: 'Obra de teste', artist: 'Artista', imageUrl: '/api/catalog/1/image', provider: 'Fixture' };
async function lot(options = {}) {
  return transaction(client => createLot(client, seller.id, { title: 'Lote de teste', initialAmount: 10000, increment: 1000,
    startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 600000).toISOString(), ...options }, item), { notify: false });
}
async function expire(id) {
  await transaction(async client => {
    const { rows: [l] } = await client.query('UPDATE lots SET ends_at=$2 WHERE id=$1 RETURNING *', [id, new Date(Date.now() - 1000)]);
    await seal(client, l);
  }, { notify: false });
}
before(async () => {
  admin = new pg.Client({ connectionString: config.databaseUrl }); await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool.options.options = `-c search_path=${schema}`;
  await pool.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  await pool.query("INSERT INTO catalog(id,snapshot,image,image_type) VALUES(1,$1,$2,'image/jpeg')", [item, Buffer.from('fixture')]);
  server = createApp().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  seller = await account('seller', 'auctioneer'); ana = await account('ana', 'bidder'); bruno = await account('bruno', 'bidder');
  for (const user of [ana, bruno]) assert.equal((await request('/wallet/deposit', 'POST', { amount: 100000 }, user)).status, 200);
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await pool.end();
  if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
test('autenticação, perfis e validação de depósitos', async () => {
  assert.equal((await request('/wallet')).status, 401);
  assert.equal((await request('/wallet/deposit', 'POST', { amount: 100 }, seller)).status, 403);
  assert.equal((await request('/wallet/deposit', 'POST', { amount: 0.5 }, ana)).status, 400);
  assert.equal((await request('/auth/login', 'POST', { email: 'ana@test.com', password: 'wrong-password' })).status, 401);
  const result = await request('/auth/me', 'GET', undefined, ana);
  assert.equal(result.data.user.email, 'ana@test.com');
  assert.equal(result.data.user.password_hash, undefined);
  assert.equal((await request('/exhibition?page=0')).status, 400);
  assert.equal((await request('/exhibition?page=abc')).status, 400);
  assert.equal((await request('/catalog')).status, 401);
});
test('lance reserva saldo, impede autocobertura e libera o usuário superado', async () => {
  const l = await lot();
  assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, ana)).status, 201);
  let balance = (await request('/wallet', 'GET', undefined, ana)).data;
  assert.equal(balance.reserved, 10000); assert.equal(balance.available, 90000);
  assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount: 11000 }, ana)).data.code, 'ALREADY_LEADING');
  assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount: 10999 }, bruno)).data.code, 'BID_TOO_LOW');
  assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount: 11000 }, bruno)).status, 201);
  balance = (await request('/wallet', 'GET', undefined, ana)).data;
  assert.equal(balance.reserved, 0); assert.equal(balance.available, 100000);
  assert.equal((await request(`/lots/${l.id}/cancel`, 'POST', {}, seller)).status, 409);
});
test('concorrência entre lotes não permite gastar o mesmo saldo duas vezes', async () => {
  const c = await account('concurrent', 'bidder');
  await request('/wallet/deposit', 'POST', { amount: 10000 }, c);
  const a = await lot(), b = await lot();
  const results = await Promise.all([a, b].map(l => request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, c)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await request('/wallet', 'GET', undefined, c)).data.available, 0);
});
test('concorrência no mesmo lote aceita apenas um lance de mesmo valor', async () => {
  const l = await lot();
  const results = await Promise.all([ana, bruno].map(u => request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, u)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await request(`/lots/${l.id}/audit`)).data.count, 1);
});
test('prorroga o fim, liquida uma única vez e gera comprovante público sem dados pessoais', async () => {
  const l = await lot({ endsAt: new Date(Date.now() + 30000).toISOString() });
  const beforeBid = Date.now();
  const bid = await request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, ana);
  assert.equal(bid.data.extended, true);
  assert.ok(new Date(bid.data.endsAt).getTime() >= beforeBid + 120000);
  const beforeBalance = (await request('/wallet', 'GET', undefined, ana)).data.total;
  await expire(l.id);
  let detail = await request(`/lots/${l.id}`);
  assert.equal(detail.data.lot.phase, 'closed');
  const receipt = await request(`/receipts/${detail.data.lot.receipt_id}`);
  assert.equal(receipt.status, 200); assert.equal(receipt.data.valid, true); assert.equal(receipt.data.winner, ana.alias);
  const publicData = JSON.stringify(receipt.data);
  assert.ok(!publicData.includes(ana.email)); assert.ok(!publicData.includes(ana.id));
  assert.equal((await request('/wallet', 'GET', undefined, ana)).data.total, beforeBalance - 10000);
  await transaction(settleDue, { notify: false }); await transaction(settleDue, { notify: false });
  assert.equal((await request('/wallet', 'GET', undefined, ana)).data.total, beforeBalance - 10000);
  assert.equal((await request('/wallet', 'GET', undefined, seller)).data.total, 10000);
  assert.equal((await request(`/lots/${l.id}/audit`)).data.valid, true);
});
test('cancelamento só pelo dono e antes de lances; lote cancelado sai da vitrine', async () => {
  const l = await lot(), other = await account('other-seller', 'auctioneer');
  assert.equal((await request(`/lots/${l.id}/cancel`, 'POST', {}, other)).status, 403);
  assert.equal((await request(`/lots/${l.id}/cancel`, 'POST', {}, seller)).status, 200);
  assert.ok(!(await request('/lots')).data.lots.some(row => row.id === l.id));
  assert.equal((await request(`/lots/${l.id}/audit`)).data.valid, true);
});
test('encerramento sem lances não gera vencedor ou comprovante', async () => {
  const l = await lot(); await expire(l.id);
  const detail = await request(`/lots/${l.id}`);
  assert.equal(detail.data.lot.phase, 'closed'); assert.equal(detail.data.lot.receipt_id, null);
  assert.equal(detail.data.lot.leader_alias, null);
});
test('adulteração direta no banco é pública e bloqueia liquidação', async () => {
  const l = await lot();
  await request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, ana);
  await pool.query('UPDATE bids SET amount=1 WHERE lot_id=$1', [l.id]);
  const audit = await request(`/lots/${l.id}/audit`);
  assert.equal(audit.data.valid, false);
  assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount: 11000 }, bruno)).data.code, 'AUDIT_FAILED');
  await pool.query('UPDATE lots SET ends_at=$2 WHERE id=$1', [l.id, new Date(Date.now() - 1000)]);
  await transaction(settleDue, { notify: false });
  assert.equal((await pool.query('SELECT status FROM lots WHERE id=$1', [l.id])).rows[0].status, 'open');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipts WHERE lot_id=$1', [l.id])).rows[0].n, 0);
});

test('posição considera o maior lance de cada licitante e não revela identificadores', async () => {
  const l = await lot();
  assert.equal((await request(`/lots/${l.id}`, 'GET', undefined, ana)).data.lot.position, null);
  for (const [user, amount] of [[ana, 10000], [bruno, 11000], [ana, 12000]]) {
    assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount }, user)).status, 201);
  }
  assert.equal((await request(`/lots/${l.id}`, 'GET', undefined, ana)).data.lot.position, 1);
  assert.equal((await request(`/lots/${l.id}`, 'GET', undefined, bruno)).data.lot.position, 2);
  const publicDetail = (await request(`/lots/${l.id}`)).data;
  assert.equal(publicDetail.lot.position, null);
  assert.ok(!JSON.stringify(publicDetail).includes(ana.id));
});

test('auditoria detecta alteração de um microssegundo no lance e nos prazos', async () => {
  for (const target of ['placed_at', 'starts_at', 'ends_at']) {
    const l = await lot();
    assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, ana)).status, 201);
    assert.equal((await request(`/lots/${l.id}/audit`)).data.valid, true);
    if (target === 'placed_at') await pool.query("UPDATE bids SET placed_at=placed_at+interval '1 microsecond' WHERE lot_id=$1", [l.id]);
    else await pool.query(`UPDATE lots SET ${target}=${target}+interval '1 microsecond' WHERE id=$1`, [l.id]);
    const result = await request(`/lots/${l.id}/audit`);
    assert.equal(result.status, 200);
    assert.equal(result.data.valid, false);
    assert.equal((await request(`/lots/${l.id}/bids`, 'POST', { amount: 11000 }, bruno)).data.code, 'AUDIT_FAILED');
    await pool.query("UPDATE lots SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [l.id]);
    await transaction(settleDue, { notify: false });
    assert.equal((await pool.query('SELECT status FROM lots WHERE id=$1', [l.id])).rows[0].status, 'open');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipts WHERE lot_id=$1', [l.id])).rows[0].n, 0);
  }
});

test('hash Unicode adulterado não derruba auditoria ou liquidação dos demais lotes', async () => {
  const l = await lot();
  await request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, ana);
  await pool.query('UPDATE bids SET hash=$2 WHERE lot_id=$1', [l.id, 'é'.repeat(64)]);
  const result = await request(`/lots/${l.id}/audit`);
  assert.equal(result.status, 200); assert.equal(result.data.valid, false);
  await pool.query("UPDATE lots SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [l.id]);
  const validLot = await lot(); await expire(validLot.id);
  assert.equal((await request(`/lots/${validLot.id}`)).data.lot.phase, 'closed');
  assert.equal((await request('/lots')).status, 200);
});

test('lance após liquidação retorna LOT_CLOSED', async () => {
  const l = await lot(); await expire(l.id);
  await request(`/lots/${l.id}`);
  const result = await request(`/lots/${l.id}/bids`, 'POST', { amount: 10000 }, bruno);
  assert.equal(result.status, 409); assert.equal(result.data.code, 'LOT_CLOSED');
});

test('preparação da demonstração cria lote apenas quando necessário e preserva dados', async () => {
  const owner = await account('demo-seller', 'auctioneer');
  const prepare = () => transaction(client => ensureDemoLot(client, owner.id, item), { notify: false });
  const first = await prepare(), repeated = await prepare();
  assert.equal(first.created, true); assert.equal(repeated.created, false);
  assert.equal(first.id, repeated.id);
  const balance = (await request('/wallet', 'GET', undefined, owner)).data.total;
  await expire(first.id); await request(`/lots/${first.id}`);
  const next = await prepare();
  assert.equal(next.created, true); assert.notEqual(next.id, first.id);
  assert.equal((await request(`/lots/${first.id}`)).data.lot.phase, 'closed');
  assert.equal((await request(`/lots/${next.id}`)).data.lot.phase, 'live');
  assert.equal((await request('/wallet', 'GET', undefined, owner)).data.total, balance);
});
