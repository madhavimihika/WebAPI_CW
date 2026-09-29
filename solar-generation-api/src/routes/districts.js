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
 * AUTHORIZATION
 *   Every GET on this router requires a bearer token carrying the
 *   'analyst-read' scope (authenticate + requireScope).
 *
 *   GET /districts/:id and GET /districts/:id/substations additionally mount
 *   the shared requireJurisdiction middleware, which reads the district id off
 *   req.params.id and 403s when it is outside the caller's jurisdiction.
 *   GET /districts/:id/substations is the clearest case for it: the child rows
 *   are all inside district :id, so authorizing the parent authorizes the
 *   whole response.
 *
 *   GET /districts is a collection, so there is no single id to authorize
 *   against - the middleware cannot help. The handler narrows the query itself
 *   by role (national: all, provincial: their province, district: their own
 *   district, device: 403 FORBIDDEN_ROLE).
 *
 * All queries are parameterized ($1). Errors are passed to next(err) and
 * handled by the central error handler in app.js.
 *
 * Collections currently return every row in scope. When the dataset grows, add
 * ?limit=&offset= here (e.g. `LIMIT $n OFFSET $n+1` with defaults) and make
 * `total` a separate `SELECT count(*)` over the same WHERE clause so it keeps
 * reporting the full size rather than the page size.
 */

const express = require('express');
const pool = require('../db');
const { authenticate, requireScope } = require('../middleware/auth');
const { requireJurisdiction } = require('../middleware/authorize');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

const router = express.Router();

// GET /districts
router.get('/', authenticate, requireScope('analyst-read'), async (req, res, next) => {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;

    // The four roles differ only in the WHERE clause, so build it once. Values
    // always travel in `params`; only the placeholder index is concatenated
    // into the SQL text.
    let where = '';
    const params = [];

    if (role === 'national') {
      // No filter: the whole country.
    } else if (role === 'provincial') {
      params.push(jurisdictionId);
      where = `WHERE d.province_id = $${params.length}`;
    } else if (role === 'district') {
      params.push(jurisdictionId);
      where = `WHERE d.id = $${params.length}`;
    } else if (role === 'device') {
      // A device token should never carry 'analyst-read'; if it does, it still
      // does not get to enumerate districts.
      return res.status(403).json({
        error: 'Device tokens cannot perform analyst reads',
        code: 'FORBIDDEN_ROLE',
      });
    }

    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.province_id
         FROM districts d
         ${where}
         ORDER BY d.name ASC`,
      params
    );

    res.set('ETag', generateETag(rows));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /districts/:id
router.get(
  '/:id',
  authenticate,
  requireScope('analyst-read'),
  requireJurisdiction,
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, name, province_id FROM districts WHERE id = $1',
        [req.params.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'District not found' });
      }

      const responseBody = { data: rows[0] };
      setCacheHeaders(res, responseBody, new Date());
      if (checkConditional(req, res, generateETag(responseBody))) return;
      res.json(responseBody);
    } catch (err) {
      next(err);
    }
  }
);

// GET /districts/:id/substations
router.get(
  '/:id/substations',
  authenticate,
  requireScope('analyst-read'),
  requireJurisdiction,
  async (req, res, next) => {
    try {
      // requireJurisdiction has already confirmed the district exists and is
      // inside the caller's jurisdiction, so the parent-existence query below is
      // now only a belt-and-braces 404 (the middleware returns 404 for an
      // unknown district itself).
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
  }
);

module.exports = router;
