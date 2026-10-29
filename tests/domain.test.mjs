import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cents, validateBid, extendedEnd, GENESIS, sign, digest, bidData, headData, audit, equal, canonicalTimestamp } from '../server/domain.mjs';
const now = Date.now(), secret = 'test-secret-kept-outside-the-database';
const user = { id: 'alice', role: 'bidder' };
const base = () => ({ id: randomUUID(), seller_id: 'seller', title: 'Arte', snapshot: { id: 1 }, status: 'open',
  starts_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 300000).toISOString(),
  initial_amount: 10000, increment: 1000, bid_count: 0, current_amount: null, leader_id: null, audit_head: GENESIS });
test('valores monetários usam centavos inteiros e positivos', () => {
  assert.equal(cents(10001), 10001);
  for (const amount of [0, -100, 1.2, NaN, Infinity, '100', Number.MAX_SAFE_INTEGER]) assert.throws(() => cents(amount));
});
test('primeiro lance pode ser igual ao inicial; seguintes respeitam incremento', () => {
  const lot = base();
  assert.doesNotThrow(() => validateBid(lot, user, 10000, 10000, now));
  assert.throws(() => validateBid(lot, user, 9999, 10000, now), /mínimo/);
  lot.bid_count = 1; lot.current_amount = 10000; lot.leader_id = 'bob';
  assert.throws(() => validateBid(lot, user, 10999, 20000, now), /mínimo/);
  assert.doesNotThrow(() => validateBid(lot, user, 11000, 11000, now));
});
test('recusa líder, vendedor, saldo insuficiente e lote fora do horário', () => {
  assert.throws(() => validateBid({ ...base(), leader_id: 'alice' }, user, 20000, 50000, now), /ganhando/);
  assert.throws(() => validateBid(base(), { ...user, role: 'auctioneer' }, 20000, 50000, now), /licitantes/);
  assert.throws(() => validateBid(base(), user, 20000, 19999, now), /insuficiente/);
  assert.throws(() => validateBid({ ...base(), starts_at: new Date(now + 1) }, user, 20000, 50000, now), /não começou/);
  assert.throws(() => validateBid({ ...base(), ends_at: new Date(now) }, user, 20000, 50000, now), /encerrado/);
});
test('anti-sniping só prorroga nos dois minutos finais', () => {
  assert.equal(extendedEnd(now + 300000, now), new Date(now + 300000).toISOString());
  assert.equal(extendedEnd(now + 30000, now), new Date(now + 120000).toISOString());
  assert.equal(extendedEnd(now + 120000, now), new Date(now + 120000).toISOString());
});
function signedHistory() {
  const lot = base();
  const bids = ['alice', 'bob', 'alice'].map((bidder, i, array) => ({ id: randomUUID(), lot_id: lot.id, sequence: i + 1,
    bidder_id: bidder, bidder_alias: `Licitante-${bidder}`, amount: 10000 + i * 1000, placed_at: new Date(now + i).toISOString() }));
  let previous = GENESIS;
  for (const b of bids) { b.previous_hash = previous; b.hash = digest(bidData(b)); previous = b.hash; }
  Object.assign(lot, { bid_count: 3, audit_head: previous, leader_id: 'alice', current_amount: 12000 });
  lot.audit_seal = sign(headData(lot), secret);
  return { lot, bids };
}
test('auditoria detecta edição, remoção no meio, remoção no fim e inserção', () => {
  const { lot, bids } = signedHistory();
  assert.equal(audit(lot, bids, secret).valid, true);
  const edited = structuredClone(bids); edited[0].amount++;
  assert.equal(audit(lot, edited, secret).valid, false);
  assert.equal(audit(lot, [bids[0], bids[2]], secret).valid, false);
  assert.equal(audit(lot, bids.slice(0, -1), secret).valid, false);
  assert.equal(audit(lot, [...bids, { ...bids[2], id: randomUUID(), sequence: 4 }], secret).valid, false);
});
test('recalcular os hashes e o cabeçalho no banco não forja a assinatura externa', () => {
  const { lot, bids } = signedHistory();
  bids[0].amount = 1;
  let previous = GENESIS;
  for (const b of bids) { b.previous_hash = previous; b.hash = digest(bidData(b)); previous = b.hash; }
  lot.audit_head = previous;
  assert.equal(audit(lot, bids, secret).valid, false);
  assert.equal(audit({ ...lot, bid_count: 0, audit_head: GENESIS, leader_id: null, current_amount: null }, [], secret).valid, false);
});

test('comparação de assinaturas malformadas falha sem lançar erro', () => {
  assert.equal(equal('a'.repeat(64), 'é'.repeat(64)), false);
  assert.equal(equal('abc', null), false);
  const { lot, bids } = signedHistory();
  bids[0].hash = 'é'.repeat(64);
  assert.equal(audit(lot, bids, secret).valid, false);
  assert.equal(audit({ ...lot, audit_seal: 'é'.repeat(64) }, [], secret).valid, false);
});

test('horários preservam microssegundos e assinaturas antigas em milissegundos', () => {
  assert.equal(canonicalTimestamp('2026-10-28 01:00:00.123000+00'), '2026-10-28T01:00:00.123Z');
  assert.equal(canonicalTimestamp('2026-10-27 22:00:00.123001-03'), '2026-10-28T01:00:00.123001Z');
  const { lot, bids } = signedHistory();
  bids[0].placed_at = bids[0].placed_at.replace('Z', '001Z');
  assert.equal(audit(lot, bids, secret).valid, false);
  assert.equal(audit({ ...lot, ends_at: 'infinity' }, bids, secret).valid, false);
});

test('lotes encerrados e cancelados retornam códigos específicos', () => {
  for (const [status, code] of [['closed', 'LOT_CLOSED'], ['cancelled', 'LOT_CANCELLED']]) {
    assert.throws(() => validateBid({ ...base(), status }, user, 10000, 10000, now), e => e.code === code);
  }
});
