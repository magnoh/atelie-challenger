CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('auctioneer','bidder')),
 alias text UNIQUE NOT NULL, balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog (
 id integer PRIMARY KEY, snapshot jsonb NOT NULL, image bytea, image_type text,
 fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lots (
 id uuid PRIMARY KEY, seller_id uuid NOT NULL REFERENCES users(id), item_id integer NOT NULL REFERENCES catalog(id),
 snapshot jsonb NOT NULL, title text NOT NULL, initial_amount bigint NOT NULL CHECK (initial_amount > 0),
 increment bigint NOT NULL CHECK (increment > 0), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
 leader_id uuid REFERENCES users(id), current_amount bigint, bid_count integer NOT NULL DEFAULT 0,
 audit_head text NOT NULL, audit_seal text NOT NULL, settled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS bids (
 id uuid PRIMARY KEY, lot_id uuid NOT NULL REFERENCES lots(id), sequence integer NOT NULL,
 bidder_id uuid NOT NULL REFERENCES users(id), bidder_alias text NOT NULL,
 amount bigint NOT NULL CHECK (amount > 0), placed_at timestamptz NOT NULL,
 previous_hash text NOT NULL, hash text NOT NULL, UNIQUE(lot_id, sequence)
);
CREATE INDEX IF NOT EXISTS bids_lot_idx ON bids(lot_id,sequence);
CREATE INDEX IF NOT EXISTS lots_ends_idx ON lots(ends_at) WHERE status='open';
CREATE TABLE IF NOT EXISTS ledger (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), lot_id uuid REFERENCES lots(id),
 kind text NOT NULL CHECK (kind IN ('deposit','purchase','sale')), amount bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS receipts (
 id uuid PRIMARY KEY, lot_id uuid UNIQUE NOT NULL REFERENCES lots(id),
 payload jsonb NOT NULL, signature text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
