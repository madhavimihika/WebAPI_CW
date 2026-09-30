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

async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, site_name, meter_id, substation_id FROM installations WHERE id = $1', [id]
  );
  return rows[0] || null;
}

async function substationExists(id) {
  const { rows } = await pool.query('SELECT id FROM substations WHERE id = $1', [id]);
  return rows.length > 0;
}

async function meterIdExists(meterId, exceptInstallationId) {
  const values = [meterId];
  let sql = 'SELECT id FROM installations WHERE meter_id = $1';
  if (exceptInstallationId !== undefined) {
    values.push(exceptInstallationId);
    sql += ` AND id <> $${values.length}`;
  }
  const { rows } = await pool.query(sql, values);
  return rows.length > 0;
}

async function createInstallation(siteName, meterId, substationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize generated IDs so concurrent creates cannot pick the same number.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['installations-id-sequence']);
    const duplicate = await client.query('SELECT id FROM installations WHERE meter_id = $1', [meterId]);
    if (duplicate.rows.length) {
      await client.query('COMMIT');
      return { duplicate: true, record: null };
    }
    const sequence = await client.query(
      `SELECT COALESCE(MAX(SUBSTRING(id FROM 3)::BIGINT), 0) + 1 AS next_id
         FROM installations WHERE id ~ '^i-[0-9]+$'`
    );
    const id = `i-${String(sequence.rows[0].next_id).padStart(4, '0')}`;
    const inserted = await client.query(
      `INSERT INTO installations (id, site_name, meter_id, substation_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, site_name, meter_id, substation_id`,
      [id, siteName, meterId, substationId]
    );
    await client.query('COMMIT');
    return { duplicate: false, record: inserted.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateInstallation(id, siteName, meterId, substationId) {
  const { rows } = await pool.query(
    `UPDATE installations
        SET site_name = $2, meter_id = $3, substation_id = $4
      WHERE id = $1
      RETURNING id, site_name, meter_id, substation_id`,
    [id, siteName, meterId, substationId]
  );
  return rows[0] || null;
}

async function deleteInstallationPreservingReadings(id) {
  // The database FK uses ON DELETE SET NULL so readings remain as audit records.
  const { rows } = await pool.query(
    `DELETE FROM installations WHERE id = $1
     RETURNING id, site_name, meter_id, substation_id`, [id]
  );
  return rows[0] || null;
}

module.exports = {
  findAllForRoleAndFilters,
  findParentWithJurisdiction,
  findByIdWithDetails,
  findLastReading,
  findById,
  substationExists,
  meterIdExists,
  createInstallation,
  updateInstallation,
  deleteInstallationPreservingReadings,
};
