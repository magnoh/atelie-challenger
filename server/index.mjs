import { createApp } from './app.mjs';
import { pool, updates } from './db.mjs';
import { config } from './config.mjs';
import { settle } from './service.mjs';
const app = createApp();
await pool.query('SELECT 1');
const server = app.listen(config.port, '0.0.0.0', () => console.log(`Ateliê: http://localhost:${config.port}`));
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try { await settle(); } catch (e) { console.error('Liquidação:', e.message); }
  finally { running = false; }
}, 1000);
updates.on('refresh', app.locals.broadcast);
async function shutdown() {
  clearInterval(timer);
  for (const { res } of app.locals.streams.values()) res.end();
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
