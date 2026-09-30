const pool = require('../db');

async function findAllForRole(role, jurisdictionId) {
  const conditions = [];
  const values = [];
  if (role === 'provincial') {
    values.push(jurisdictionId);
    conditions.push(`d.province_id = $${values.length}`);
  } else if (role === 'district') {
    values.push(jurisdictionId);
    conditions.push(`s.district_id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.district_id FROM substations s
     JOIN districts d ON d.id = s.district_id ${where} ORDER BY s.name ASC`, values
  );
  return rows;
}

async function findByIdWithJurisdiction(id) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.district_id, d.province_id FROM substations s
     JOIN districts d ON d.id = s.district_id WHERE s.id = $1`, [id]
  );
  return rows[0] || null;
}

async function findInstallations(substationId) {
  const { rows } = await pool.query(
    'SELECT id, site_name, meter_id, substation_id FROM installations WHERE substation_id = $1 ORDER BY site_name ASC',
    [substationId]
  );
  return rows;
}

module.exports = { findAllForRole, findByIdWithJurisdiction, findInstallations };
