const pool = require('../db');

async function findAllForRoleAndFilters(role, jurisdictionId, filters) {
  const conditions = [];
  const values = [];
  const addCondition = (sql, value) => {
    values.push(value);
    conditions.push(`${sql} $${values.length}`);
  };
  if (role === 'provincial') addCondition('d.province_id =', jurisdictionId);
  else if (role === 'district') addCondition('d.id =', jurisdictionId);
  if (filters.substation_id !== undefined) addCondition('i.substation_id =', filters.substation_id);
  if (filters.district_id !== undefined) addCondition('s.district_id =', filters.district_id);
  if (filters.province_id !== undefined) addCondition('d.province_id =', filters.province_id);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT i.id, i.site_name, i.meter_id, i.substation_id
       FROM installations i JOIN substations s ON s.id = i.substation_id
       JOIN districts d ON d.id = s.district_id ${where} ORDER BY i.site_name ASC`, values
  );
  return rows;
}

async function findParentWithJurisdiction(id) {
  const { rows } = await pool.query(
    `SELECT i.id, i.site_name, s.district_id, d.province_id
       FROM installations i JOIN substations s ON s.id = i.substation_id
       JOIN districts d ON d.id = s.district_id WHERE i.id = $1`, [id]
  );
  return rows[0] || null;
}

async function findByIdWithDetails(id) {
  const { rows } = await pool.query(
    `SELECT i.id, i.site_name, i.meter_id, i.substation_id,
            s.name AS substation_name, d.id AS district_id, d.name AS district_name,
            p.id AS province_id, p.name AS province_name
       FROM installations i JOIN substations s ON s.id = i.substation_id
       JOIN districts d ON d.id = s.district_id JOIN provinces p ON p.id = d.province_id
       WHERE i.id = $1`, [id]
  );
  return rows[0] || null;
}

async function findLastReading(id) {
  const { rows } = await pool.query(
    `SELECT id, installation_id, timestamp, power_kw::float AS power_kw,
            energy_kwh::float AS energy_kwh, voltage::float AS voltage
       FROM readings WHERE installation_id = $1 ORDER BY timestamp DESC LIMIT 1`, [id]
  );
  return rows[0] || null;
}

module.exports = { findAllForRoleAndFilters, findParentWithJurisdiction, findByIdWithDetails, findLastReading };
