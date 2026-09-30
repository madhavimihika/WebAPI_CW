const pool = require('../db');

async function findInstallationSite(installationId) {
  return pool.query(
    `SELECT i.id, s.district_id, d.province_id
       FROM installations i
       JOIN substations s ON s.id = i.substation_id
       JOIN districts d ON d.id = s.district_id
       WHERE i.id = $1`,
    [installationId]
  );
}

async function findInstallation(installationId) {
  return pool.query('SELECT id FROM installations WHERE id = $1', [installationId]);
}

async function countReadings(whereClause, values) {
  return pool.query(`SELECT count(*)::int AS total FROM readings WHERE ${whereClause}`, values);
}

async function listReadings(whereClause, sort, values, filterCount, limit, offset) {
  return pool.query(
    `SELECT id, installation_id, timestamp,
            power_kw::float AS power_kw,
            energy_kwh::float AS energy_kwh,
            voltage::float AS voltage
       FROM readings
       WHERE ${whereClause}
       ORDER BY ${sort.column} ${sort.direction}
       LIMIT $${filterCount + 1} OFFSET $${filterCount + 2}`,
    [...values, limit, offset]
  );
}

async function findReadingAt(installationId, timestamp) {
  return pool.query('SELECT id FROM readings WHERE installation_id = $1 AND timestamp = $2', [installationId, timestamp]);
}

async function insertReading(id, installationId, timestamp, power_kw, energy_kwh, voltage) {
  return pool.query(
    `INSERT INTO readings
       (id, installation_id, timestamp, power_kw, energy_kwh, voltage)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, installation_id, timestamp,
               power_kw::float AS power_kw,
               energy_kwh::float AS energy_kwh,
               voltage::float AS voltage`,
    [id, installationId, timestamp, power_kw, energy_kwh, voltage]
  );
}

module.exports = { findInstallationSite, findInstallation, countReadings, listReadings, findReadingAt, insertReading };
