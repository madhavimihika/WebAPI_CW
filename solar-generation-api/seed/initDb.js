/**
 * initDb.js
 * ---------------------------------------------------------------------------
 * Initializes the PostgreSQL schema for the Solar Generation API and loads
 * the data produced by seed/generateSeed.js (seed.json in the project root).
 *
 * Run with:  node seed/initDb.js
 *
 * Plain `pg` + `dotenv` only - no ORM.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SEED_PATH = path.join(__dirname, '..', 'seed.json');
const READING_BATCH_SIZE = 500;
const PROGRESS_EVERY = 10000;

/**
 * Table DDL, listed in creation order (parents before children).
 */
const CREATE_STATEMENTS = [
  `CREATE TABLE provinces (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL
   )`,
  `CREATE TABLE districts (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     province_id TEXT NOT NULL REFERENCES provinces(id)
   )`,
  `CREATE TABLE substations (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     district_id TEXT NOT NULL REFERENCES districts(id)
   )`,
  `CREATE TABLE installations (
     id TEXT PRIMARY KEY,
     site_name TEXT NOT NULL,
     meter_id TEXT NOT NULL UNIQUE,
     substation_id TEXT NOT NULL REFERENCES substations(id)
   )`,
  `CREATE TABLE readings (
     id TEXT PRIMARY KEY,
     installation_id TEXT NOT NULL REFERENCES installations(id),
     timestamp TIMESTAMPTZ NOT NULL,
     power_kw NUMERIC NOT NULL,
     energy_kwh NUMERIC NOT NULL,
     voltage NUMERIC NOT NULL
   )`,
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     role TEXT NOT NULL,
     jurisdiction_id TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS readings_installation_id_timestamp_idx
     ON readings (installation_id, timestamp DESC)`,
];

// Drop order matters: readings -> installations -> substations -> districts ->
// provinces -> users (children before parents because of the FKs).
const DROP_STATEMENTS = [
  'DROP TABLE IF EXISTS readings CASCADE',
  'DROP TABLE IF EXISTS installations CASCADE',
  'DROP TABLE IF EXISTS substations CASCADE',
  'DROP TABLE IF EXISTS districts CASCADE',
  'DROP TABLE IF EXISTS provinces CASCADE',
  'DROP TABLE IF EXISTS users CASCADE',
];

/** Simple tables: one parameterized INSERT per row. */
const SIMPLE_TABLES = [
  { table: 'provinces', columns: ['id', 'name'] },
  { table: 'districts', columns: ['id', 'name', 'province_id'] },
  { table: 'substations', columns: ['id', 'name', 'district_id'] },
  { table: 'installations', columns: ['id', 'site_name', 'meter_id', 'substation_id'] },
];

const READING_COLUMNS = [
  'id',
  'installation_id',
  'timestamp',
  'power_kw',
  'energy_kwh',
  'voltage',
];

/**
 * Inserts an array of seed rows into `table` using one parameterized query per
 * row. All values are sent as text and cast by Postgres, so schema changes
 * (e.g. TEXT -> UUID ids) do not break the script.
 */
async function insertRows(client, table, columns, rows) {
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
    .map((_, i) => `$${i + 1}`)
    .join(', ')})`;

  for (const row of rows) {
    await client.query(sql, columns.map((col) => row[col]));
  }

  console.log(`  ${table}: ${rows.length} rows inserted`);
  return rows.length;
}

/**
 * Inserts readings in multi-row batches:
 * INSERT INTO readings (...) VALUES ($1,...,$6), ($7,...,$12), ...
 * 500 rows per statement = 3,000 bind parameters, well inside Postgres' 65,535
 * parameter limit.
 */
async function insertReadings(client, rows) {
  let inserted = 0;

  for (let start = 0; start < rows.length; start += READING_BATCH_SIZE) {
    const batch = rows.slice(start, start + READING_BATCH_SIZE);
    const params = [];
    const tuples = batch.map((row) => {
      const placeholders = READING_COLUMNS.map((col) => {
        params.push(row[col]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql = `INSERT INTO readings (${READING_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`;
    await client.query(sql, params);

    inserted += batch.length;
    if (inserted % PROGRESS_EVERY === 0 || inserted === rows.length) {
      console.log(`  readings: ${inserted}/${rows.length} rows inserted`);
    }
  }

  return inserted;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to solar-generation-api/.env');
  }

  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Seed file not found at ${SEED_PATH}. Run "node seed/generateSeed.js" first.`);
  }

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL');

  try {
    console.log('Dropping existing tables (CASCADE order)...');
    for (const statement of DROP_STATEMENTS) {
      await client.query(statement);
    }

    console.log('Creating tables...');
    for (const statement of CREATE_STATEMENTS) {
      await client.query(statement);
    }
    console.log(`  ${CREATE_STATEMENTS.length - 1} tables + 1 index created`);

    console.log('Inserting seed data...');
    let total = 0;

    // parents before children, so every foreign key already exists.
    for (const { table, columns } of SIMPLE_TABLES) {
      total += await insertRows(client, table, columns, seed[table] || []);
    }
    total += await insertReadings(client, seed.readings || []);

    console.log(`Total rows inserted: ${total}`);
  } finally {
    await client.end();
  }

  console.log(' Database initialized successfully');
}

main().catch((err) => {
  console.error(` Error: ${err.message}`);
  process.exit(1);
});
