CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL, desired_enabled BOOLEAN NOT NULL DEFAULT true,
  desired_version INTEGER NOT NULL DEFAULT 0, reported_enabled BOOLEAN,
  reported_version INTEGER, last_seen_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS commands (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES devices(id), enabled BOOLEAN NOT NULL,
  version INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  confirmed_at TIMESTAMPTZ, UNIQUE(device_id, version)
);
-- A chave idempotente não depende do horário de ingestão da hypertable.
CREATE TABLE IF NOT EXISTS event_receipts (
  device_id TEXT NOT NULL REFERENCES devices(id), event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL, PRIMARY KEY(device_id, event_id)
);
CREATE TABLE IF NOT EXISTS events (
  time TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), id BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id UUID NOT NULL, device_id TEXT NOT NULL, event_id TEXT NOT NULL,
  event_type TEXT NOT NULL, payload JSONB NOT NULL, PRIMARY KEY(time, id)
);
SELECT create_hypertable('events', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS events_user_time ON events(user_id, time DESC, id DESC);
CREATE INDEX IF NOT EXISTS events_user_device_time ON events(user_id, device_id, time DESC, id DESC);
