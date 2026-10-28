#!/bin/sh
set -eu

# Keep the generated signing key across container recreation, just like the DB.
# An explicitly configured key (for example from .env through Compose) takes priority.
if [ -z "${AUDIT_SECRET:-}" ]; then
  if [ ! -s /app/data/audit-secret ]; then
    umask 077
    node -e "require('fs').writeFileSync('/app/data/audit-secret', require('crypto').randomBytes(48).toString('hex'), {flag: 'wx', mode: 0o600})"
  fi
  AUDIT_SECRET="$(cat /app/data/audit-secret)"
  export AUDIT_SECRET
fi

node server/migrate.mjs
node server/seed.mjs
exec node server/index.mjs
