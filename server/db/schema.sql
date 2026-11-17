CREATE TABLE IF NOT EXISTS network_snapshots (
  id BIGSERIAL PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL,
  mempool_count BIGINT NOT NULL DEFAULT 0,
  mempool_vsize BIGINT NOT NULL DEFAULT 0,
  btc_price_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  tip_height BIGINT NOT NULL DEFAULT 0,
  fastest_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_network_snapshots_fetched_at ON network_snapshots (fetched_at DESC);

CREATE TABLE IF NOT EXISTS transaction_observations (
  txid TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL,
  value_btc DOUBLE PRECISION NOT NULL DEFAULT 0,
  value_sats DOUBLE PRECISION NOT NULL DEFAULT 0,
  fee_sats DOUBLE PRECISION NOT NULL DEFAULT 0,
  fee_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  vsize DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_transaction_observations_first_seen ON transaction_observations (first_seen DESC);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  score INTEGER NOT NULL,
  severity TEXT NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_detected_at ON anomaly_alerts (detected_at DESC);

CREATE TABLE IF NOT EXISTS arrival_windows (
  observed_at TIMESTAMPTZ PRIMARY KEY,
  new_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_insights (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  question TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  payload JSONB NOT NULL,
  input_snapshot JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_created_at ON ai_insights (created_at DESC);
