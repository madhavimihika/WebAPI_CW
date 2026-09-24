/**
 * routes/readings.js
 * ---------------------------------------------------------------------------
 * READINGS endpoints, mounted under an installation.
 *
 *   GET /installations/:id/readings  -> paginated readings, newest first
 *
 * Mounted with `app.use('/installations/:id/readings', readingsRouter)` and
 * `express.Router({ mergeParams: true })` so `:id` from the mount path is
 * visible here as `req.params.id`.
 *
 * Query params:
 *   ?page=1   which page to return         (default 1, min 1)
 *   ?limit=50 how many rows per page       (default 50, max 200)
 *
 * The columns power_kw / energy_kwh / voltage are NUMERIC in Postgres, which
 * `pg` returns as strings (NUMERIC has arbitrary precision, so it can't map to
 * a JS number safely by default). They are cast with `::float` in the SELECT so
 * the JSON response carries real numbers instead of "1.23".
 *
 * Parameterized queries only ($1, $2, ...). Errors are passed to next(err) and
 * handled by the central error handler in app.js.
 */

const express = require('express');
const pool = require('../db');

// mergeParams: true is required - without it req.params.id from the mount path
// ('/installations/:id/readings') would not be forwarded to this router.
const router = express.Router({ mergeParams: true });

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Parses a positive-integer query param, falling back to `fallback` when the
 * value is missing, not a number, or < 1. Keeps `limit` inside MAX_LIMIT.
 */
function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max !== undefined ? Math.min(parsed, max) : parsed;
}

/**
 * Builds a next/previous link for the current page, preserving the effective
 * page/limit. Returns null when there is no such page.
 */
function buildPageLink(installationId, page, limit, basePath) {
  return `${basePath}?page=${page}&limit=${limit}`;
}

// GET /installations/:id/readings
router.get('/', async (req, res, next) => {
  try {
    const installationId = req.params.id;

    // 1. Make sure the installation exists before touching its readings, so a
    //    bad id returns 404 rather than an empty page of data.
    const installation = await pool.query(
      'SELECT id FROM installations WHERE id = $1',
      [installationId]
    );

    if (installation.rows.length === 0) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // 2. Normalise pagination: page >= 1, 1 <= limit <= 200.
    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (page - 1) * limit;

    // 3. Total row count drives `pages` and the next/previous links.
    const countResult = await pool.query(
      'SELECT count(*)::int AS total FROM readings WHERE installation_id = $1',
      [installationId]
    );
    const total = countResult.rows[0].total;
    const pages = Math.max(1, Math.ceil(total / limit));

    // 4. The page of rows. `::float` turns the NUMERIC columns into JSON numbers;
    //    `timestamp DESC` uses the (installation_id, timestamp DESC) index.
    const readingsResult = await pool.query(
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
       LIMIT $2 OFFSET $3`,
      [installationId, limit, offset]
    );

    // 5. Links are relative to the request; req.baseUrl is
    //    '/installations/:id/readings' with the real id substituted.
    const basePath = req.baseUrl;
    const next = page < pages ? buildPageLink(installationId, page + 1, limit, basePath) : null;
    const previous = page > 1 ? buildPageLink(installationId, page - 1, limit, basePath) : null;

    res.json({
      data: readingsResult.rows,
      pagination: {
        total,
        page,
        limit,
        pages,
        next,
        previous,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;