import { randomUUID } from 'node:crypto';
import { pool, transaction } from './db.mjs';
import { config } from './config.mjs';
import { GENESIS, ensure, cents, phase, validateBid, extendedEnd, sign, digest, bidData, headData, audit } from './domain.mjs';
export async function seal(client, lot) {
  lot.audit_seal = sign(headData(lot), config.secret);
  await client.query('UPDATE lots SET audit_seal=$2 WHERE id=$1', [lot.id, lot.audit_seal]);
}
export async function auditLot(client, lot) {
  const { rows: bids } = await client.query('SELECT * FROM bids WHERE lot_id=$1 ORDER BY sequence', [lot.id]);
  return { ...audit(lot, bids, config.secret), bids: bids.map(b => ({ id: b.id, sequence: b.sequence, bidder: b.bidder_alias, amount: b.amount, placedAt: b.placed_at, hash: b.hash, previousHash: b.previous_hash })) };
}
export async function settleDue(client) {
  const { rows } = await client.query("SELECT * FROM lots WHERE status='open' AND ends_at<=clock_timestamp() ORDER BY ends_at");
  let completed = 0;
  for (const lot of rows) {
    const integrity = await auditLot(client, lot);
    // Refuse financial settlement of an altered history. It remains publicly auditable.
    if (!integrity.valid) continue;
    const at = new Date().toISOString();
    if (lot.leader_id) {
      const paid = await client.query('UPDATE users SET balance=balance-$2 WHERE id=$1 AND balance >= $2 RETURNING id', [lot.leader_id, lot.current_amount]);
      ensure(paid.rowCount, 'Saldo inconsistente na liquidação.', 409);
      await client.query('UPDATE users SET balance=balance+$2 WHERE id=$1', [lot.seller_id, lot.current_amount]);
      for (const [user, kind, amount] of [[lot.leader_id, 'purchase', -lot.current_amount], [lot.seller_id, 'sale', lot.current_amount]]) {
        await client.query('INSERT INTO ledger(id,user_id,lot_id,kind,amount) VALUES($1,$2,$3,$4,$5)', [randomUUID(), user, lot.id, kind, amount]);
      }
      const last = integrity.bids.at(-1);
      const payload = { version: 1, lotId: lot.id, title: lot.title, item: lot.snapshot, winner: last.bidder,
        amount: lot.current_amount, issuedAt: at, bidCount: lot.bid_count, auditHead: lot.audit_head, currency: 'BRL' };
      const id = randomUUID();
      await client.query('INSERT INTO receipts(id,lot_id,payload,signature) VALUES($1,$2,$3,$4)', [id, lot.id, payload, sign({ id, ...payload }, config.secret)]);
    }
    lot.status = 'closed';
    await client.query("UPDATE lots SET status='closed',settled_at=$2 WHERE id=$1", [lot.id, at]);
    await seal(client, lot);
    completed++;
  }
  return completed;
}
export async function wallet(client, userId) {
  const { rows: [user] } = await client.query('SELECT balance FROM users WHERE id=$1', [userId]);
  const { rows: [reserved] } = await client.query("SELECT COALESCE(SUM(current_amount),0)::bigint AS amount FROM lots WHERE leader_id=$1 AND status='open'", [userId]);
  return { total: user.balance, reserved: reserved.amount, available: user.balance - reserved.amount };
}
export async function mutate(fn) {
  return transaction(async client => {
    await settleDue(client);
    return fn(client);
  });
}
export async function createLot(client, sellerId, input, item) {
  const now = Date.now();
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  ensure(Number.isFinite(+startsAt) && Number.isFinite(+endsAt), 'Datas inválidas.');
  ensure(+endsAt > Math.max(+startsAt, now) && +endsAt - +startsAt <= 30 * 86400_000, 'O fim deve ser futuro, após o início e em até 30 dias.');
  const lot = { id: randomUUID(), seller_id: sellerId, item_id: item.id, snapshot: item,
    title: (input.title || item.title).trim(), initial_amount: cents(input.initialAmount), increment: cents(input.increment),
    starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), status: 'open', leader_id: null,
    current_amount: null, bid_count: 0, audit_head: GENESIS };
  lot.audit_seal = sign(headData(lot), config.secret);
  await client.query(`INSERT INTO lots(id,seller_id,item_id,snapshot,title,initial_amount,increment,starts_at,ends_at,audit_head,audit_seal)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [lot.id, sellerId, item.id, item, lot.title, lot.initial_amount, lot.increment, lot.starts_at, lot.ends_at, lot.audit_head, lot.audit_seal]);
  return lot;
}
export async function placeBid(client, lotId, user, amount) {
  const { rows: [lot] } = await client.query('SELECT * FROM lots WHERE id=$1', [lotId]);
  ensure(lot, 'Lote não encontrado.', 404);
  const integrity = await auditLot(client, lot);
  ensure(integrity.valid, 'Lote bloqueado: histórico não íntegro. Consulte a auditoria.', 409, 'AUDIT_FAILED');
  const now = Date.now();
  validateBid(lot, user, amount, (await wallet(client, user.id)).available, now);
  const bid = { id: randomUUID(), lot_id: lotId, sequence: lot.bid_count + 1, bidder_id: user.id,
    bidder_alias: user.alias, amount, placed_at: new Date(now).toISOString(), previous_hash: lot.audit_head };
  bid.hash = digest(bidData(bid));
  await client.query('INSERT INTO bids(id,lot_id,sequence,bidder_id,bidder_alias,amount,placed_at,previous_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [bid.id, lotId, bid.sequence, user.id, user.alias, amount, bid.placed_at, bid.previous_hash, bid.hash]);
  const endsAt = extendedEnd(lot.ends_at, now);
  const extended = new Date(endsAt).getTime() !== new Date(lot.ends_at).getTime();
  Object.assign(lot, { leader_id: user.id, current_amount: amount, bid_count: bid.sequence, audit_head: bid.hash, ends_at: endsAt });
  await client.query('UPDATE lots SET leader_id=$2,current_amount=$3,bid_count=$4,audit_head=$5,ends_at=$6 WHERE id=$1', [lotId, user.id, amount, bid.sequence, bid.hash, endsAt]);
  await seal(client, lot);
  return { accepted: true, extended, endsAt, amount, message: extended ? 'Lance aceito. Prazo prorrogado por 2 minutos.' : 'Lance aceito. Você está ganhando!' };
}
export async function cancelLot(client, id, sellerId) {
  const { rows: [lot] } = await client.query('SELECT * FROM lots WHERE id=$1', [id]);
  ensure(lot, 'Lote não encontrado.', 404);
  ensure(lot.seller_id === sellerId, 'Este lote pertence a outro leiloeiro.', 403);
  ensure(lot.status === 'open' && phase(lot) !== 'closed', 'Este lote já foi finalizado.', 409);
  ensure(lot.bid_count === 0, 'Um lote que recebeu lances não pode ser cancelado.', 409);
  ensure((await auditLot(client, lot)).valid, 'Histórico não íntegro.', 409);
  lot.status = 'cancelled';
  await client.query("UPDATE lots SET status='cancelled' WHERE id=$1", [id]);
  await seal(client, lot);
  return { cancelled: true };
}
export async function listLots(client, user = null, own = false) {
  const { rows } = await client.query(`SELECT l.*,u.alias AS leader_alias,r.id AS receipt_id,
    EXISTS(SELECT 1 FROM bids b WHERE b.lot_id=l.id AND b.bidder_id=$1) AS participated
    FROM lots l LEFT JOIN users u ON u.id=l.leader_id LEFT JOIN receipts r ON r.lot_id=l.id
    WHERE ($2::boolean AND l.seller_id=$1) OR (NOT $2::boolean AND l.status<>'cancelled') ORDER BY l.created_at DESC`, [user?.id ?? null, own]);
  return rows.map(lot => publicLot(lot, user));
}
export function publicLot(lot, user) {
  const { seller_id, leader_id, audit_seal, ...rest } = lot;
  return { ...rest, phase: phase(lot), isLeading: !!user && leader_id === user.id,
    isOwner: !!user && seller_id === user.id, minimumBid: lot.bid_count ? lot.current_amount + lot.increment : lot.initial_amount };
}
export async function bidderPosition(client, lotId, user) {
  if (user?.role !== 'bidder') return null;
  const { rows: [entry] } = await client.query(`
    SELECT position::int FROM (
      SELECT bidder_id, rank() OVER (ORDER BY max(amount) DESC) AS position
      FROM bids WHERE lot_id=$1 GROUP BY bidder_id
    ) ranking WHERE bidder_id=$2`, [lotId, user.id]);
  return entry?.position ?? null;
}
export async function settle() { return transaction(settleDue, { notify: count => count > 0 }); }
