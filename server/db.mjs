import pg from 'pg';
import { EventEmitter } from 'node:events';
import { config } from './config.mjs';
import { canonicalTimestamp } from './domain.mjs';
pg.types.setTypeParser(20, value => Number(value));
pg.types.setTypeParser(1184, canonicalTimestamp);
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
export const updates = new EventEmitter();
// One transaction lock gives wallet operations a single global ordering, even across processes.
export async function transaction(fn, { notify = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20261022)');
    const result = await fn(client);
    await client.query('COMMIT');
    if (notify && (typeof notify !== 'function' || notify(result))) updates.emit('refresh');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
