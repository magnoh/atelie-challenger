import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from './db.mjs';
import { hashPassword } from './domain.mjs';
import { createLot, placeBid, seal, settleDue } from './service.mjs';
const items = JSON.parse(await readFile(new URL('./data/catalog.json', import.meta.url), 'utf8'));
const password = process.env.SEED_PASSWORD || 'Verzel2026!';
try {
  const hash = await hashPassword(password);
  await transaction(async client => {
    const accounts = [
      { email: 'leiloeiro@demo.com', name: 'Marina', role: 'auctioneer', alias: 'Leiloeiro-Marina' },
      { email: 'ana@demo.com', name: 'Ana', role: 'bidder', alias: 'Colecionador-ANA01' },
      { email: 'bruno@demo.com', name: 'Bruno', role: 'bidder', alias: 'Colecionador-BRUNO02' }
    ];
    for (const account of accounts) {
      const inserted = await client.query(`INSERT INTO users(id,email,name,password_hash,role,alias)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING RETURNING id`,
        [randomUUID(), account.email, account.name, hash, account.role, account.alias]);
      const { rows: [user] } = await client.query('SELECT * FROM users WHERE email=$1', [account.email]);
      Object.assign(account, user);
      if (inserted.rowCount && account.role === 'bidder') {
        await client.query('UPDATE users SET balance=1000000 WHERE id=$1', [account.id]);
        await client.query("INSERT INTO ledger(id,user_id,kind,amount) VALUES($1,$2,'deposit',1000000)", [randomUUID(), account.id]);
      }
    }
    for (const item of items) {
      const image = await readFile(new URL(`../public/art/${item.id}.jpg`, import.meta.url));
      await client.query("INSERT INTO catalog(id,snapshot,image,image_type) VALUES($1,$2,$3,'image/jpeg') ON CONFLICT(id) DO NOTHING", [item.id, item, image]);
    }
    await settleDue(client);
    const { rows: [existing] } = await client.query('SELECT COUNT(*)::int AS count FROM lots WHERE seller_id=$1', [accounts[0].id]);
    if (existing.count) { console.log('Dados de demonstração já existem. Nenhum saldo ou prazo foi reiniciado.'); return; }
    const now = Date.now(), seller = accounts[0], ana = accounts[1];
    const sample = [
      { item: 0, title: 'Campo de trigo com ciprestes', start: -300_000, end: 3600_000, price: 50000, bid: 55000 },
      { item: 2, title: 'A grande onda de Kanagawa', start: -300_000, end: 7200_000, price: 30000 },
      { item: 3, title: 'Veneza sob o olhar de Turner', start: -300_000, end: 5400_000, price: 40000 },
      { item: 4, title: 'Um encontro com Degas', start: 86400_000, end: 90000_000, price: 25000 },
      { item: 1, title: 'Autorretrato com chapéu de palha', start: -7200_000, end: 3600_000, price: 60000, bid: 65000, closed: true }
    ];
    for (const entry of sample) {
      const lot = await createLot(client, seller.id, { title: entry.title, startsAt: new Date(now + entry.start).toISOString(),
        endsAt: new Date(now + entry.end).toISOString(), initialAmount: entry.price, increment: 2500 }, items[entry.item]);
      if (entry.bid) await placeBid(client, lot.id, ana, entry.bid);
      if (entry.closed) {
        const { rows: [updated] } = await client.query('UPDATE lots SET ends_at=$2 WHERE id=$1 RETURNING *', [lot.id, new Date(now - 1000)]);
        await seal(client, updated);
      }
    }
    await settleDue(client);
    console.log('Criados: 1 leiloeiro, 2 licitantes, 3 lotes ao vivo, 1 agendado e 1 arrematado.');
  });
  console.log('Contas: leiloeiro@demo.com, ana@demo.com, bruno@demo.com. Senha: a definida em SEED_PASSWORD (padrão documentado no README).');
} finally { await pool.end(); }
