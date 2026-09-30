// Correct legacy integer references after the database moved to prefixed IDs.
const dotenv = require('dotenv');
const path = require('path');
const { Client } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from solar-generation-api/.env');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(
      "UPDATE users SET jurisdiction_id = 'd-01' WHERE username = 'district-colombo'"
    );
    await client.query(
      "UPDATE users SET jurisdiction_id = 'p-01' WHERE username = 'provincial-western'"
    );
    await client.query(
      "UPDATE users SET installation_id = 'i-0001' WHERE username = 'device-1'"
    );

    const { rows } = await client.query(
      `SELECT username, role, scope, jurisdiction_id, installation_id
         FROM users ORDER BY username`
    );
    console.table(rows);
  } finally {
    await client.end();
  }

  console.log('✅ Users updated');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
