/**
 * seed/initUsers.js
 * ---------------------------------------------------------------------------
 * Standalone script that (re)creates the `users` table and seeds the four test
 * accounts used by the JWT authentication work.
 *
 * Run with:  node seed/initUsers.js
 *
 * This is step 1 of the auth work only: it seeds credentials. There is no login
 * endpoint, no auth middleware and no token signing here.
 *
 * Plain `pg` + `dotenv` + `bcryptjs` - no ORM.
 *
 * Note: this script owns the `users` table. Running it drops and recreates that
 * table (CASCADE), so any users added outside this script are lost. It does not
 * touch provinces / districts / substations / installations / readings.
 */

require('dotenv').config();

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;

/**
 * Table DDL. `installation_id` is a plain nullable TEXT column: devices are
 * scoped by the installation they own, not by a jurisdiction, so it is NULL for
 * every non-device user.
 *
 * jurisdiction_level is one of 'district' | 'province' | NULL.
 * jurisdiction_id points at districts.id or provinces.id depending on the level.
 */
const CREATE_USERS_TABLE = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    scope TEXT NOT NULL,
    jurisdiction_level TEXT,
    jurisdiction_id TEXT,
    installation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

/**
 * The four test accounts.
 *
 * Passwords are plaintext here on purpose - this is a seed script for a test
 * database. They are hashed with bcryptjs before they reach the database and are
 * never logged.
 */
const USERS = [
  {
    id: 'u-001',
    username: 'device-1',
    password: 'device-pass-1',
    role: 'device',
    scope: 'installation-write',
    jurisdiction_level: null,
    jurisdiction_id: null,
    installation_id: '1',
  },
  {
    id: 'u-002',
    username: 'district-colombo',
    password: 'district-pass-1',
    role: 'district',
    scope: 'analyst-read',
    jurisdiction_level: 'district',
    jurisdiction_id: '1',
    installation_id: null,
  },
  {
    id: 'u-003',
    username: 'provincial-western',
    password: 'provincial-pass-1',
    role: 'provincial',
    scope: 'analyst-read',
    jurisdiction_level: 'province',
    jurisdiction_id: '1',
    installation_id: null,
  },
  {
    id: 'u-004',
    username: 'national-user',
    password: 'national-pass-1',
    role: 'national',
    scope: 'analyst-read',
    jurisdiction_level: null,
    jurisdiction_id: null,
    installation_id: null,
  },
];

/**
 * Inserts the seeded users. Each password is hashed with bcryptjs.hashSync at
 * cost factor 10 and only the hash is stored.
 */
async function seedUsers(client) {
  const sql = `
    INSERT INTO users
      (id, username, password_hash, role, scope, jurisdiction_level, jurisdiction_id, installation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `;

  for (const user of USERS) {
    const passwordHash = bcrypt.hashSync(user.password, BCRYPT_ROUNDS);

    await client.query(sql, [
      user.id,
      user.username,
      passwordHash,
      user.role,
      user.scope,
      user.jurisdiction_level,
      user.jurisdiction_id,
      user.installation_id,
    ]);

    // Deliberately logs no password and no hash.
    console.log(
      `  ${user.id} | ${user.username} | role=${user.role} | scope=${user.scope}`
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to solar-generation-api/.env');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL');

  try {
    console.log('Dropping existing users table...');
    await client.query('DROP TABLE IF EXISTS users CASCADE');

    console.log('Creating users table...');
    await client.query(CREATE_USERS_TABLE);

    console.log('Seeding users...');
    await seedUsers(client);
  } finally {
    await client.end();
  }

  console.log('✅ Users seeded successfully');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});