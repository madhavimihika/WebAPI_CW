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
 * AUTHORIZATION
 *   Every GET on this router requires a bearer token carrying the
 *   'analyst-read' scope (authenticate + requireScope).
 *
 *   Jurisdiction is enforced inside the handlers rather than with the shared
 *   requireJurisdiction middleware, because that middleware reads a DISTRICT
 *   id off req.params.id / req.query.district_id - and here :id is a SUBSTATION
 *   id. Passing a substation id to it would look up districts.id = <substation
 *   id>, which is a different (and wrong) question.
 *
 *   Instead every handler walks one step UP the hierarchy: substations ->
 *   districts. That single join is what turns a substation into the district
 *   the middleware would have needed.
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
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

const router = express.Router();

// GET /substations
router.get('/', authenticate, requireScope('analyst-read'), async (req, res, next) => {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;

    if (role === 'device') {
      return res.status(403).json({
        error: 'Device tokens cannot perform analyst reads',
        code: 'FORBIDDEN_ROLE',
      });
    }

    // JOIN is required even for national: it is how a substation row is tied to
    // the district it belongs to. national adds no WHERE clause on top.
    const conditions = [];
    const params = [];

    if (role === 'provincial') {
      params.push(jurisdictionId);
      conditions.push(`d.province_id = $${params.length}`);
    } else if (role === 'district') {
      params.push(jurisdictionId);
      conditions.push(`s.district_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.district_id
         FROM substations s
         JOIN districts d ON d.id = s.district_id
         ${where}
         ORDER BY s.name ASC`,
      params
    );

    res.set('ETag', generateETag(rows));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /substations/:id
router.get('/:id', authenticate, requireScope('analyst-read'), async (req, res, next) => {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;

    if (role === 'device') {
      return res.status(403).json({
        error: 'Device tokens cannot perform analyst reads',
        code: 'FORBIDDEN_ROLE',
      });
    }

    // One query does both jobs: it proves the substation exists (404 when it
    // does not) and hands back the district/province it sits in, which is what
    // the jurisdiction decision needs.
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.district_id, d.province_id
         FROM substations s
         JOIN districts d ON d.id = s.district_id
         WHERE s.id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Substation not found' });
    }

    const substation = rows[0];

    // String() coercion matches requireJurisdiction: JWT ids arrive as strings,
    // the schema stores them as TEXT, but this stays correct either way.
    const allowed =
      role === 'national' ||
      (role === 'provincial' &&
        String(substation.province_id) === String(jurisdictionId)) ||
      (role === 'district' && String(substation.district_id) === String(jurisdictionId));

    if (!allowed) {
      return res.status(403).json({
        error: 'Outside your jurisdiction',
        code: 'OUTSIDE_JURISDICTION',
      });
    }

    // province_id is only a join artifact - the response keeps its original
    // { id, name, district_id } shape.
    const responseBody = {
      data: {
        id: substation.id,
        name: substation.name,
        district_id: substation.district_id,
      },
    };
    setCacheHeaders(res, responseBody, new Date());
    if (checkConditional(req, res, generateETag(responseBody))) return;
    res.json(responseBody);
  } catch (err) {
    next(err);
  }
});

// GET /substations/:id/installations
router.get(
  '/:id/installations',
  authenticate,
  requireScope('analyst-read'),
  async (req, res, next) => {
    try {
      const { role, jurisdiction_id: jurisdictionId } = req.user;

      if (role === 'device') {
        return res.status(403).json({
          error: 'Device tokens cannot perform analyst reads',
          code: 'FORBIDDEN_ROLE',
        });
      }

      // Same parent check as before, now carrying the district/province so the
      // jurisdiction decision is free.
      const parent = await pool.query(
        `SELECT s.id, s.district_id, d.province_id
           FROM substations s
           JOIN districts d ON d.id = s.district_id
           WHERE s.id = $1`,
        [req.params.id]
      );

      if (parent.rows.length === 0) {
        return res.status(404).json({ error: 'Substation not found' });
      }

      const substation = parent.rows[0];

      const allowed =
        role === 'national' ||
        (role === 'provincial' &&
          String(substation.province_id) === String(jurisdictionId)) ||
        (role === 'district' &&
          String(substation.district_id) === String(jurisdictionId));

      if (!allowed) {
        return res.status(403).json({
          error: 'Outside your jurisdiction',
          code: 'OUTSIDE_JURISDICTION',
        });
      }

      // No further filtering needed: every installation here belongs to the
      // substation that was just authorized, so authorizing the parent
      // authorizes the whole child set.
      const { rows } = await pool.query(
        'SELECT id, site_name, meter_id, substation_id FROM installations WHERE substation_id = $1 ORDER BY site_name ASC',
        [req.params.id]
      );

      res.json({ data: rows, total: rows.length });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
