/**
 * routes/installations.js
 * ---------------------------------------------------------------------------
 * Installation endpoints.
 *
 *   GET /installations        -> { data: [...], total: N } (ordered by site_name)
 *   GET /installations/:id    -> one installation (plus substation/district/
 *                               province names), or 404 { error: "Installation not found" }
 *   GET /installations/:id/last-known-reading
 *                             -> the single most recent reading for the site
 *                               (a derived/operational "what is it generating
 *                               right now?" view), or 404 with either
 *                               "Installation not found" (no such site) or
 *                               "No readings for this installation".
 *
 * Optional filters on the collection (combinable):
 *   ?substation_id=X  direct
 *   ?district_id=X    via substations
 *   ?province_id=X    via substations -> districts
 *
 * Parameterized queries only ($1, $2, ...). Errors are passed to next(err) and
 * handled by the central error handler in app.js.
 *
 * Pagination is deliberately not implemented yet - add ?limit=&offset= here
 * (append `LIMIT $n OFFSET $n+1` to the built SQL) and make `total` a separate
 * `SELECT count(*)` over the same WHERE clause so it reports the full size
 * rather than the page size.
 */

const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /installations
router.get('/', async (req, res, next) => {
  try {
    const { substation_id, district_id, province_id } = req.query;

    // Build the WHERE clause from whichever filters were supplied. The values
    // go into `params` and only the placeholder *index* is concatenated into
    // the SQL, so no user input ever reaches the query text.
    const conditions = [];
    const params = [];

    if (substation_id !== undefined) {
      params.push(substation_id);
      conditions.push(`i.substation_id = $${params.length}`);
    }

    if (district_id !== undefined) {
      params.push(district_id);
      conditions.push(`s.district_id = $${params.length}`);
    }

    if (province_id !== undefined) {
      params.push(province_id);
      conditions.push(`d.province_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // The joins are needed not only for filtering but also for the
    // province -> district -> substation path to be traversable at all.
    const sql = `
      SELECT i.id, i.site_name, i.meter_id, i.substation_id
      FROM installations i
      JOIN substations s ON s.id = i.substation_id
      JOIN districts d ON d.id = s.district_id
      ${where}
      ORDER BY i.site_name ASC
    `;

    const { rows } = await pool.query(sql, params);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /installations/:id/last-known-reading
//
// Derived/operational resource: the most recent reading for the installation,
// answering "what is this site generating right now?". Must be declared before
// the '/:id' route below, otherwise Express would match '/:id' first and treat
// "last-known-reading" as an installation id.
router.get('/:id/last-known-reading', async (req, res, next) => {
  try {
    // 1. Does the installation exist? Distinguishes a bad id (404 Installation
    //    not found) from a real site that simply has no readings yet.
    const installation = await pool.query(
      'SELECT id, site_name FROM installations WHERE id = $1',
      [req.params.id]
    );

    if (installation.rows.length === 0) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // 2. Latest reading for this site. ORDER BY timestamp DESC LIMIT 1 uses the
    //    (installation_id, timestamp DESC) index. ::float turns the NUMERIC
    //    columns into JSON numbers rather than strings.
    const { rows } = await pool.query(
      `SELECT
         installation_id,
         timestamp,
         power_kw::float   AS power_kw,
         energy_kwh::float AS energy_kwh,
         voltage::float    AS voltage
       FROM readings
       WHERE installation_id = $1
       ORDER BY timestamp DESC
       LIMIT 1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No readings for this installation' });
    }

    // site_name comes from the installation, not the reading row.
    res.json({ ...rows[0], site_name: installation.rows[0].site_name });
  } catch (err) {
    next(err);
  }
});

// GET /installations/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         i.id,
         i.site_name,
         i.meter_id,
         i.substation_id,
         s.name AS substation_name,
         d.id   AS district_id,
         d.name AS district_name,
         p.id   AS province_id,
         p.name AS province_name
       FROM installations i
       JOIN substations s ON s.id = i.substation_id
       JOIN districts d ON d.id = s.district_id
       JOIN provinces p ON p.id = d.province_id
       WHERE i.id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
