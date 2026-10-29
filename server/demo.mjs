import { createLot } from './service.mjs';

// Called inside the seed transaction: never changes existing lots or balances.
export async function ensureDemoLot(client, sellerId, item) {
  const { rows: [existing] } = await client.query(`SELECT id FROM lots
    WHERE seller_id=$1 AND status='open' AND starts_at<=clock_timestamp()
      AND ends_at>clock_timestamp() LIMIT 1`, [sellerId]);
  if (existing) return { created: false, id: existing.id };
  const now = Date.now();
  const lot = await createLot(client, sellerId, {
    title: `${item.title} — demonstração`,
    startsAt: new Date(now - 1000).toISOString(),
    endsAt: new Date(now + 7 * 86400_000).toISOString(),
    initialAmount: 10000, increment: 1000,
  }, item);
  return { created: true, id: lot.id };
}
