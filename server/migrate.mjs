import { readFile } from 'node:fs/promises';
import { pool } from './db.mjs';
try { await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); console.log('Schema atualizado.'); }
finally { await pool.end(); }
