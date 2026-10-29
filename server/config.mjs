export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgres://auction:auction@127.0.0.1:5432/auction',
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || 'http://localhost:5173',
  secret: process.env.AUDIT_SECRET,
  production: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
};
if (!config.secret || config.secret.length < 32) throw new Error('Configure AUDIT_SECRET com pelo menos 32 caracteres.');
