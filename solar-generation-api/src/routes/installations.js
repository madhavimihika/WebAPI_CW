/**
 * routes/installations.js
 * ---------------------------------------------------------------------------
 * Installation endpoints.
 *
 *   GET /installations        -> { data: [...], total: N } (ordered by site_name)
 *   GET /installations/:id    -> one installation (plus substation/district/
 *                               province names and latest reading), or 404
 *                               { error: "Installation not found" }
 *   GET /installations/:id/last-known-reading
 *                             -> the single most recent reading for the site
 *                               (a derived/operational "what is it generating
 *                               right now?" view), or 404 with either
 *                               "Installation not found" (no such site) or
 *                               "No readings for this installation".
 *
 * AUTHORIZATION
 *   Every GET on this router requires a bearer token carrying the
 *   'analyst-read' scope (authenticate + requireScope).
 *
 *   Jurisdiction is enforced inside the handlers rather than with the shared
 *   requireJurisdiction middleware, because that middleware authorizes against
 *   a DISTRICT id read off req.params.id - and here :id is an INSTALLATION id.
 *   The installation -> substation -> district walk is two joins the middleware
 *   does not perform.
 *
 *   The ?district_id / ?province_id filters below are NOT an authorization
 *   mechanism: they narrow a result set, they do not widen it. Jurisdiction is
 *   applied independently of whatever the client asks for.
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
const { authenticate, requireScope } = require('../middleware/auth');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

const router = express.Router();

async function getLastReading(installationId) {
  const { rows } = await pool.query(
    `SELECT
       id,
       installation_id,
       timestamp,
       power_kw::float   AS power_kw,
       energy_kwh::float AS energy_kwh,
       voltage::float    AS voltage
     FROM readings
     WHERE installation_id = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [installationId]
  );

  return rows[0] || null;
}

// GET /installations
router.get('/', authenticate, requireScope('analyst-read'), async (req, res, next) => {
  try {
    const { substation_id, district_id, province_id } = req.query;
    const { role, jurisdiction_id: jurisdictionId } = req.user;

    if (role === 'device') {
      return res.status(403).json({
        error: 'Device tokens cannot perform analyst reads',
        code: 'FORBIDDEN_ROLE',
      });
    }

    // Build the WHERE clause from the jurisdiction rule plus whichever filters
    // were supplied. The values go into `params` and only the placeholder
    // *index* is concatenated into the SQL, so no user input ever reaches the
    // query text.
    const conditions = [];
    const params = [];

    // Jurisdiction. The joins are needed not only for filtering but also for
    // the province -> district -> substation -> installation path to be
    // traversable at all.
    if (role === 'provincial') {
      params.push(jurisdictionId);
      conditions.push(`d.province_id = $${params.length}`);
    } else if (role === 'district') {
      params.push(jurisdictionId);
      conditions.push(`d.id = $${params.length}`);
    }

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

    const sql = `
      SELECT i.id, i.site_name, i.meter_id, i.substation_id
      FROM installations i
      JOIN substations s ON s.id = i.substation_id
      JOIN districts d ON d.id = s.district_id
      ${where}
      ORDER BY i.site_name ASC
    `;

    const { rows } = await pool.query(sql, params);
    res.set('ETag', generateETag(rows));
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
router.get(
  '/:id/last-known-reading',
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

      // 1. Does the installation exist, and where does it sit? Distinguishes a
      //    bad id (404 Installation not found) from a real site that simply has
      //    no readings yet, and supplies the district/province the jurisdiction
      //    decision needs - in the same query.
      const installation = await pool.query(
        `SELECT i.id, i.site_name, s.district_id, d.province_id
           FROM installations i
           JOIN substations s ON s.id = i.substation_id
           JOIN districts d ON d.id = s.district_id
           WHERE i.id = $1`,
        [req.params.id]
      );

      if (installation.rows.length === 0) {
        return res.status(404).json({ error: 'Installation not found' });
      }

      const site = installation.rows[0];

      const allowed =
        role === 'national' ||
        (role === 'provincial' &&
          String(site.province_id) === String(jurisdictionId)) ||
        (role === 'district' && String(site.district_id) === String(jurisdictionId));

      if (!allowed) {
        return res.status(403).json({
          error: 'Outside your jurisdiction',
          code: 'OUTSIDE_JURISDICTION',
        });
      }

      // 2. Return only the derived reading fields for this processing function.
      const reading = await getLastReading(req.params.id);

      if (!reading) {
        return res.status(404).json({
          error: 'No readings for this installation',
          code: 'NOT_FOUND',
        });
      }

      setCacheHeaders(res, reading, reading.timestamp);
      if (checkConditional(req, res, generateETag(reading))) return;
      res.json(reading);
    } catch (err) {
      next(err);
    }
  }
);

// GET /installations/:id
router.get('/:id', authenticate, requireScope('analyst-read'), async (req, res, next) => {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;

    if (role === 'device') {
      return res.status(403).json({
        error: 'Device tokens cannot perform analyst reads',
        code: 'FORBIDDEN_ROLE',
      });
    }

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

    const installation = rows[0];

    const allowed =
      role === 'national' ||
      (role === 'provincial' &&
        String(installation.province_id) === String(jurisdictionId)) ||
      (role === 'district' && String(installation.district_id) === String(jurisdictionId));

    if (!allowed) {
      return res.status(403).json({
        error: 'Outside your jurisdiction',
        code: 'OUTSIDE_JURISDICTION',
      });
    }

    const lastKnownReading = await getLastReading(req.params.id);
    const responseBody = { data: { ...installation, last_known_reading: lastKnownReading } };
    const lastModifiedDate = installation.created_at || new Date();
    setCacheHeaders(res, responseBody, lastModifiedDate);
    if (checkConditional(req, res, generateETag(responseBody))) return;
    res.json(responseBody);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
