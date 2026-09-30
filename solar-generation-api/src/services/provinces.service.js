const pool = require('../db');

async function findAll() {
  const { rows } = await pool.query('SELECT id, name FROM provinces ORDER BY name ASC');
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT id, name FROM provinces WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findDistrictsInProvince(provinceId) {
  const { rows } = await pool.query(
    'SELECT id, name, province_id FROM districts WHERE province_id = $1 ORDER BY name ASC',
    [provinceId]
  );
  return rows;
}

module.exports = { findAll, findById, findDistrictsInProvince };
