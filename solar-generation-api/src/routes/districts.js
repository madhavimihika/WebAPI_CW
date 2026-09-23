/**
 * routes/districts.js
 * ---------------------------------------------------------------------------
 * District endpoints.
 *
 *   GET /districts                 -> { data: [...], total: N }  (ordered by name)
 *   GET /districts/:id             -> one district, or 404 { error: "District not found" }
 *   GET /districts/:id/substations -> substations in that district
 *                                     404 if the district does not exist,
 *                                     { data: [], total: 0 } if it has none
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

// GET /districts
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, province_id FROM districts ORDER BY name ASC'
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /districts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, province_id FROM districts WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /districts/:id/substations
router.get('/:id/substations', async (req, res, next) => {
  try {
    // Check the parent first so "district does not exist" (404) is
    // distinguishable from "district exists but is empty" (200 + []).
    const district = await pool.query('SELECT id FROM districts WHERE id = $1', [
      req.params.id,
    ]);

    if (district.rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    const { rows } = await pool.query(
      'SELECT id, name, district_id FROM substations WHERE district_id = $1 ORDER BY name ASC',
      [req.params.id]
    );

    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
