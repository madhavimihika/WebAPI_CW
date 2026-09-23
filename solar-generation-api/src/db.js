/**
 * db.js
 * ---------------------------------------------------------------------------
 * Postgres connection helper. Loads DATABASE_URL from .env and exports a
 * shared connection Pool for the route files.
 *
 * Render's managed Postgres requires SSL, so `rejectUnauthorized: false` is
 * set on the pool.
 */

require('dotenv').config();

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to solar-generation-api/.env');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;
