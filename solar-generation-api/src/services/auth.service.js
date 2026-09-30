const pool = require('../db');

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT id, username, password_hash, role, scope,
            jurisdiction_level, jurisdiction_id, installation_id
       FROM users WHERE username = $1`,
    [username]
  );
  return rows[0] || null;
}

module.exports = { findUserByUsername };
