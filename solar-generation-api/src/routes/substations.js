/**
 * routes/substations.js
 * ---------------------------------------------------------------------------
 * Substation endpoints.
 *
 *   GET /substations                 -> { data: [...], total: N }  (ordered by name)
 *   GET /substations/:id             -> one substation, or 404 { error: "Substation not found" }
 *   GET /substations/:id/installations -> installations at that substation
 *                                        404 if the substation does not exist,
 *                                        { data: [], total: 0 } if it has none
 *
 * All queries are parameterized ($1). Errors are passed to next(err) and
 * handled by the central error handler in app.js.
 *
 * Collections currently return every row. When the dataset grows, add
 * ?limit=&offset= here (e.g. `LIMIT $1 OFFSET $2` with defaults) and make
 * `total` a separate `SELECT count(*)` so it keeps reporting the full size
 * rather than the page size.
 */

const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /substations
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, district_id FROM substations ORDER BY name ASC'
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /substations/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, district_id FROM substations WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Substation not found' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /substations/:id/installations
router.get('/:id/installations', async (req, res, next) => {
  try {
    // Check the parent first so "substation does not exist" (404) is
    // distinguishable from "substation exists but is empty" (200 + []).
    const substation = await pool.query('SELECT id FROM substations WHERE id = $1', [
      req.params.id,
    ]);

    if (substation.rows.length === 0) {
      return res.status(404).json({ error: 'Substation not found' });
    }

    const { rows } = await pool.query(
      'SELECT id, site_name, meter_id, substation_id FROM installations WHERE substation_id = $1 ORDER BY site_name ASC',
      [req.params.id]
    );

    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
