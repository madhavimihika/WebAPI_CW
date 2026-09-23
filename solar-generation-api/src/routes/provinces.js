/**
 * routes/provinces.js
 * ---------------------------------------------------------------------------
 * Province endpoints.
 *
 *   GET /provinces             -> { data: [...], total: N }  (all provinces, ordered by name)
 *   GET /provinces/:id         -> one province, or 404 { error: "Province not found" }
 *   GET /provinces/:id/districts -> districts in that province
 *                                   404 if the province does not exist,
 *                                   { data: [], total: 0 } if it has none
 *
 * All queries are parameterized ($1). Errors are passed to next(err) and
 * handled by the central error handler in app.js.
 */

const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /provinces
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM provinces ORDER BY name ASC'
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /provinces/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM provinces WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Province not found' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /provinces/:id/districts
router.get('/:id/districts', async (req, res, next) => {
  try {
    // Check the parent first so "province does not exist" (404) is
    // distinguishable from "province exists but is empty" (200 + []).
    const province = await pool.query('SELECT id FROM provinces WHERE id = $1', [
      req.params.id,
    ]);

    if (province.rows.length === 0) {
      return res.status(404).json({ error: 'Province not found' });
    }

    const { rows } = await pool.query(
      'SELECT id, name, province_id FROM districts WHERE province_id = $1 ORDER BY name ASC',
      [req.params.id]
    );

    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
