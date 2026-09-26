/**
 * routes/readings.js
 * ---------------------------------------------------------------------------
 * READINGS endpoints, mounted under an installation.
 *
 *   GET  /installations/:id/readings -> paginated readings, newest first
 *   POST /installations/:id/readings -> record one new reading (metering device)
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

const crypto = require('crypto');
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

/**
 * Validates a POST /installations/:id/readings body.
 *
 * Required fields:
 *   timestamp   - non-empty string that parses to a valid date
 *   power_kw    - number
 *   energy_kwh  - number
 *   voltage     - number
 *
 * Numbers must be JSON numbers (not numeric strings): the device is expected to
 * post real JSON, and accepting "4.2" would silently hide a mis-serialised
 * payload. Returns { valid, errors, value } where `value` holds the normalised
 * fields (timestamp as a Date) and is only meaningful when valid is true.
 */
function validateReadingBody(body) {
  const errors = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: 'body', message: 'Request body must be a JSON object' }],
    };
  }

  // --- timestamp -----------------------------------------------------------
  let timestamp;
  if (body.timestamp === undefined || body.timestamp === null || body.timestamp === '') {
    errors.push({ field: 'timestamp', message: 'timestamp is required' });
  } else if (typeof body.timestamp !== 'string' && typeof body.timestamp !== 'number') {
    errors.push({ field: 'timestamp', message: 'timestamp must be a date string' });
  } else {
    const parsed = new Date(body.timestamp);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ field: 'timestamp', message: 'timestamp must be a valid date' });
    } else {
      timestamp = parsed;
    }
  }

  // --- numeric fields ------------------------------------------------------
  const numericFields = ['power_kw', 'energy_kwh', 'voltage'];
  const numbers = {};

  for (const field of numericFields) {
    const value = body[field];
    if (value === undefined || value === null) {
      errors.push({ field, message: `${field} is required` });
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push({ field, message: `${field} must be a number` });
    } else {
      numbers[field] = value;
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      timestamp,
      power_kw: numbers.power_kw,
      energy_kwh: numbers.energy_kwh,
      voltage: numbers.voltage,
    },
  };
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

// POST /installations/:id/readings
router.post('/', async (req, res, next) => {
  try {
    const installationId = req.params.id;

    // 1. The installation must exist - the FK would also reject a bad id, but
    //    this returns a clear 404 instead of a database error.
    const installation = await pool.query(
      'SELECT id FROM installations WHERE id = $1',
      [installationId]
    );

    if (installation.rows.length === 0) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // 2. Validate the payload before touching the database.
    const validation = validateReadingBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_BODY',
        details: validation.errors,
      });
    }

    const { timestamp, power_kw, energy_kwh, voltage } = validation.value;

    // 3. Idempotency: one reading per (installation_id, timestamp). Checked up
    //    front so a duplicate returns 409 rather than a primary-key error.
    const duplicate = await pool.query(
      'SELECT id FROM readings WHERE installation_id = $1 AND timestamp = $2',
      [installationId, timestamp]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        error: 'Reading already exists for this timestamp',
        code: 'DUPLICATE_READING',
      });
    }

    // 4. Generate the id and insert. RETURNING with `::float` casts gives the
    //    NUMERIC columns back as JSON numbers, matching the GET response shape.
    const id = `read-${crypto.randomUUID()}`;

    const inserted = await pool.query(
      `INSERT INTO readings
         (id, installation_id, timestamp, power_kw, energy_kwh, voltage)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id,
         installation_id,
         timestamp,
         power_kw::float   AS power_kw,
         energy_kwh::float AS energy_kwh,
         voltage::float    AS voltage`,
      [id, installationId, timestamp, power_kw, energy_kwh, voltage]
    );

    // 5. Location points at the new resource under the same mount path.
    res
      .status(201)
      .location(`${req.baseUrl}/${id}`)
      .json(inserted.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;