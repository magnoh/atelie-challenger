import { createHash, createHmac, timingSafeEqual, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
export const GENESIS = '0'.repeat(64);
export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}
export function ensure(condition, message, status = 400, code) { if (!condition) throw new AppError(message, status, code); }
export function cents(value) {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000_000,
    'Informe um valor positivo em centavos (máximo R$ 1 bilhão).');
  return value;
}
export function phase(lot, now = Date.now()) {
  if (lot.status !== 'open') return lot.status;
  if (new Date(lot.ends_at).getTime() <= now) return 'closed';
  return new Date(lot.starts_at).getTime() > now ? 'scheduled' : 'live';
}
export function validateBid(lot, user, amount, available, now = Date.now()) {
  ensure(user.role === 'bidder', 'Somente licitantes podem dar lances.', 403, 'ROLE_FORBIDDEN');
  ensure(lot.status !== 'cancelled', 'O lote foi cancelado.', 409, 'LOT_CANCELLED');
  ensure(lot.status !== 'closed' && new Date(lot.ends_at).getTime() > now, 'O lote está encerrado.', 409, 'LOT_CLOSED');
  ensure(lot.status === 'open' && new Date(lot.starts_at).getTime() <= now, 'O lote ainda não começou.', 409, 'NOT_LIVE');
  ensure(lot.leader_id !== user.id, 'Você já está ganhando este lote.', 409, 'ALREADY_LEADING');
  cents(amount);
  const minimum = lot.bid_count ? lot.current_amount + lot.increment : lot.initial_amount;
  ensure(amount >= minimum, `Lance abaixo do mínimo: ${(minimum / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`, 409, 'BID_TOO_LOW');
  ensure(amount <= available, 'Saldo disponível insuficiente. Deposite na carteira.', 409, 'INSUFFICIENT_FUNDS');
}
export function extendedEnd(endsAt, now) {
  return new Date(new Date(endsAt).getTime() - now <= 120_000 ? now + 120_000 : endsAt).toISOString();
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export const sign = (value, secret) => createHmac('sha256', secret).update(canonical(value)).digest('hex');
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
// Keep legacy millisecond signatures unchanged, while preserving PostgreSQL microseconds.
export function canonicalTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return String(value);
  const fraction = typeof value === 'string' ? value.match(/[T ]\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] : '';
  const remainder = (fraction || '').slice(3).replace(/0+$/, '');
  return date.toISOString().replace(/Z$/, `${remainder}Z`);
}
export function bidData(bid) {
  return { id: bid.id, lotId: bid.lot_id, sequence: bid.sequence, bidderId: bid.bidder_id,
    bidder: bid.bidder_alias, amount: Number(bid.amount), placedAt: canonicalTimestamp(bid.placed_at), previousHash: bid.previous_hash };
}
export const headData = lot => ({ lotId: lot.id, count: lot.bid_count, head: lot.audit_head,
  leaderId: lot.leader_id, amount: lot.current_amount, initial: lot.initial_amount,
  increment: lot.increment, startsAt: canonicalTimestamp(lot.starts_at), endsAt: canonicalTimestamp(lot.ends_at),
  status: lot.status, item: lot.snapshot, sellerId: lot.seller_id, title: lot.title });
export function audit(lot, bids, secret) {
  let head = GENESIS;
  const problems = [];
  for (let i = 0; i < bids.length; i++) {
    const bid = bids[i];
    if (bid.sequence !== i + 1 || bid.lot_id !== lot.id || bid.previous_hash !== head || !equal(digest(bidData(bid)), bid.hash)) problems.push(`Lance ${i + 1} inválido.`);
    head = bid.hash;
  }
  if (bids.length !== lot.bid_count || head !== lot.audit_head) problems.push('Quantidade ou raiz do histórico divergente.');
  const last = bids.at(-1);
  if ((last?.bidder_id ?? null) !== lot.leader_id || (last ? Number(last.amount) : null) !== lot.current_amount) problems.push('Líder ou valor diverge do histórico.');
  if (!equal(sign(headData(lot), secret), lot.audit_seal)) problems.push('Assinatura do lote inválida.');
  return { valid: problems.length === 0, count: bids.length, head, problems, algorithm: 'SHA-256 + HMAC-SHA-256', verifiedAt: new Date().toISOString() };
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return equal(actual.toString('hex'), expected);
}
