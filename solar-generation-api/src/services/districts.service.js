const pool = require('../db');

async function findAllForRole(role, jurisdictionId) {
  let where = '';
  const values = [];
  if (role === 'provincial') {
    values.push(jurisdictionId);
    where = `WHERE d.province_id = $${values.length}`;
  } else if (role === 'district') {
    values.push(jurisdictionId);
    where = `WHERE d.id = $${values.length}`;
  }
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.province_id FROM districts d ${where} ORDER BY d.name ASC`, values
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT id, name, province_id FROM districts WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findSubstations(districtId) {
  const { rows } = await pool.query(
    'SELECT id, name, district_id FROM substations WHERE district_id = $1 ORDER BY name ASC', [districtId]
  );
  return rows;
}

async function districtExists(id) {
  const { rows } = await pool.query('SELECT id FROM districts WHERE id = $1', [id]);
  return rows.length > 0;
}

module.exports = { findAllForRole, findById, findSubstations, districtExists };
