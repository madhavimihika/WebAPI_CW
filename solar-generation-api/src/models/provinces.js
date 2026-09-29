/**
 * models/provinces.js
 * ---------------------------------------------------------------------------
 * Data access for the provinces resource.
 *
 * Raw SQL lives here and nowhere else. Each function returns plain rows (or
 * null) - never an HTTP response, never a status code. The route layer decides
 * what a missing row means (404, 403, or an empty list); the model only tells
 * the truth about what is in the database.
 *
 * The pool comes from ../db, so the same connection settings and SSL behaviour
 * apply as everywhere else in the app.
 *
 * Every query is parameterized ($1, $2). No value is ever interpolated into
 * SQL text.
 *
 * No Express, no req, no res.
 */

const pool = require('../db');

/**
 * All provinces, ordered by name.
 *
 * @returns {Promise<Array<{id: string, name: string}>>} rows, possibly empty.
 */
async function findAll() {
  const { rows } = await pool.query(
    'SELECT id, name FROM provinces ORDER BY name ASC'
  );
  return rows;
}

/**
 * One province by id.
 *
 * @param {string|number} id province id.
 * @returns {Promise<{id: string, name: string}|null>} the province, or null if
 *          no such province exists. "not found" is expressed as null so that
 *          callers cannot accidentally mistake an empty array for a missing
 *          record.
 */
async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, name FROM provinces WHERE id = $1',
    [id]
  );
  return rows.length === 0 ? null : rows[0];
}

/**
 * Districts belonging to a province, ordered by name.
 *
 * Does NOT verify that the province exists - an unknown province and a known
 * but empty one both come back as []. Callers that must tell those apart
 * should call findById first.
 *
 * @param {string|number} provinceId province id.
 * @returns {Promise<Array<{id: string, name: string, province_id: string}>>}
 *          rows, possibly empty.
 */
async function findDistrictsInProvince(provinceId) {
  const { rows } = await pool.query(
    'SELECT id, name, province_id FROM districts WHERE province_id = $1 ORDER BY name ASC',
    [provinceId]
  );
  return rows;
}

module.exports = { findAll, findById, findDistrictsInProvince };