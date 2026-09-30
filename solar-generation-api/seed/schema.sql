-- Core geography tables.
CREATE TABLE IF NOT EXISTS provinces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  province_id TEXT NOT NULL REFERENCES provinces(id)
);

CREATE TABLE IF NOT EXISTS grid_substations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  district_id TEXT NOT NULL REFERENCES districts(id)
);

CREATE TABLE IF NOT EXISTS solar_installations (
  id TEXT PRIMARY KEY,
  site_name TEXT NOT NULL,
  meter_id TEXT NOT NULL UNIQUE,
  substation_id TEXT NOT NULL REFERENCES grid_substations(id)
);

CREATE TABLE IF NOT EXISTS generation_readings (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES solar_installations(id),
  timestamp TIMESTAMPTZ NOT NULL,
  power_kw NUMERIC NOT NULL,
  energy_kwh NUMERIC NOT NULL,
  voltage NUMERIC NOT NULL,
  UNIQUE (installation_id, timestamp)
);

CREATE INDEX IF NOT EXISTS generation_readings_installation_timestamp_idx
  ON generation_readings (installation_id, timestamp DESC);

-- These columns match the login route and the claims used by auth middleware.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  scope TEXT NOT NULL,
  jurisdiction_level TEXT,
  jurisdiction_id TEXT,
  installation_id TEXT REFERENCES solar_installations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The current routes query these legacy names; simple views keep them working.
CREATE OR REPLACE VIEW substations AS
  SELECT id, name, district_id FROM grid_substations;
CREATE OR REPLACE VIEW installations AS
  SELECT id, site_name, meter_id, substation_id FROM solar_installations;
CREATE OR REPLACE VIEW readings AS
  SELECT id, installation_id, timestamp, power_kw, energy_kwh, voltage FROM generation_readings;
