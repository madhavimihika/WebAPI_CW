/**
 * routes/readings.js
 * ---------------------------------------------------------------------------
 * READINGS endpoints, mounted under an installation.
 *
 *   GET  /installations/:id/readings -> paginated readings, newest first
 *                                      requires authenticate + scope
 *                                      'analyst-read', and the installation's
 *                                      district must be inside the caller's
 *                                      jurisdiction
 *   POST /installations/:id/readings -> record one new reading (metering device)
 *                                      requires authenticate + scope
 *                                      'installation-write', and the token's
 *                                      installation_id must match :id
 *
 * The GET handler resolves jurisdiction itself rather than mounting the shared
 * requireJurisdiction middleware: that middleware reads a DISTRICT id off
 * req.params.id, and here :id is an INSTALLATION id. The installation ->
 * substation -> district walk is two joins it does not do.
 *
 * Mounted with `app.use('/installations/:id/readings', readingsRouter)` and
 * `express.Router({ mergeParams: true })` so `:id` from the mount path is
 * visible here as `req.params.id`.
 *
 * Query params:
 *   ?page=1                 page to return (default 1)
 *   ?limit=50               rows per page (default 50, max 200)
 *   ?from=...&to=...        inclusive timestamp range
 *   ?min_power=...          minimum power_kw
 *   ?sort=timestamp:desc    timestamp:asc is also supported
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
const { authenticate, requireScope } = require('../middleware/auth');

// mergeParams: true is required - without it req.params.id from the mount path
// ('/installations/:id/readings') would not be forwarded to this router.
const router = express.Router({ mergeParams: true });

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Parses a positive-integer query param. Missing values use the fallback;
 * provided values must contain only digits and be greater than zero.
 */
function parsePositiveInt(value, fallback) {
  if (value === undefined) return { value: fallback, valid: true };
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return { valid: false };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return { valid: false };
  return { value: parsed, valid: true };
}

/**
 * Builds a next/previous link for the current page, preserving the effective
 * page/limit. Returns null when there is no such page.
 */
function buildPageLink(page, query, basePath) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  params.set('page', String(page));
  return `${basePath}?${params.toString()}`;
}

function parseOptionalDate(value) {
  if (value === undefined) return { valid: true };
  if (typeof value !== 'string' || value.trim() === '') return { valid: false };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { valid: false } : { valid: true, value: date };
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
router.get(
  '/',
  authenticate,
  requireScope('analyst-read'),
  async (req, res, next) => {
  try {
    const installationId = req.params.id;
    const { role, jurisdiction_id: jurisdictionId } = req.user;

    if (role === 'device') {
      return res.status(403).json({
        error: 'Device tokens cannot perform analyst reads',
        code: 'FORBIDDEN_ROLE',
      });
    }

    // 1. The installation must exist, and we need to know which district it
    //    sits in. One joined query answers both, so a bad id still returns 404
    //    rather than an empty page of data.
    const installation = await pool.query(
      `SELECT i.id, s.district_id, d.province_id
         FROM installations i
         JOIN substations s ON s.id = i.substation_id
         JOIN districts d ON d.id = s.district_id
         WHERE i.id = $1`,
      [installationId]
    );

    if (installation.rows.length === 0) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const site = installation.rows[0];

    // 2. Jurisdiction, checked BEFORE any reading rows are touched. Same
    //    String() coercion as requireJurisdiction, for the same reason: JWT ids
    //    are strings, and TEXT columns are strings, but this survives a change
    //    to either side.
    const allowed =
      role === 'national' ||
      (role === 'provincial' && String(site.province_id) === String(jurisdictionId)) ||
      (role === 'district' && String(site.district_id) === String(jurisdictionId));

    if (!allowed) {
      return res.status(403).json({
        error: 'Outside your jurisdiction',
        code: 'OUTSIDE_JURISDICTION',
      });
    }

    // 3. Validate query parameters after confirming the resource and caller's
    //    jurisdiction, so the existing 404 and 403 behavior stays intact.
    const sort = req.query.sort;
    if (sort !== 'timestamp:asc' && sort !== 'timestamp:desc') {
      return res.status(400).json({ error: 'Invalid sort field', code: 'INVALID_SORT' });
    }

    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    if (!from.valid || !to.valid) {
      return res.status(400).json({ error: 'Invalid date', code: 'INVALID_DATE' });
    }

    let minPower;
    if (req.query.min_power !== undefined) {
      const rawMinPower = req.query.min_power;
      if (typeof rawMinPower !== 'string' || rawMinPower.trim() === '') {
        return res.status(400).json({ error: 'Invalid min_power', code: 'INVALID_MIN_POWER' });
      }
      minPower = Number(rawMinPower);
      if (!Number.isFinite(minPower)) {
        return res.status(400).json({ error: 'Invalid min_power', code: 'INVALID_MIN_POWER' });
      }
    }

    const parsedPage = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const parsedLimit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT);
    if (!parsedPage.valid || !parsedLimit.valid) {
      return res.status(400).json({ error: 'Invalid page or limit', code: 'INVALID_PAGINATION' });
    }
    const page = parsedPage.value;
    const limit = Math.min(parsedLimit.value, MAX_LIMIT);
    const offset = (page - 1) * limit;

    const filters = ['installation_id = $1'];
    const filterValues = [installationId];
    if (from.value) {
      filterValues.push(from.value);
      filters.push(`timestamp >= $${filterValues.length}`);
    }
    if (to.value) {
      filterValues.push(to.value);
      filters.push(`timestamp <= $${filterValues.length}`);
    }
    if (minPower !== undefined) {
      filterValues.push(minPower);
      filters.push(`power_kw >= $${filterValues.length}`);
    }
    const whereClause = filters.join(' AND ');

    // 4. Total row count drives `pages` and the next/previous links.
    const countResult = await pool.query(
      `SELECT count(*)::int AS total FROM readings WHERE ${whereClause}`,
      filterValues
    );
    const total = countResult.rows[0].total;
    const pages = Math.max(1, Math.ceil(total / limit));

    // 5. The page of rows. Values remain parameterized; the direction is chosen
    //    only from the two values validated above.
    const dataValues = [...filterValues, limit, offset];
    const readingsResult = await pool.query(
      `SELECT
         id,
         installation_id,
         timestamp,
         power_kw::float   AS power_kw,
         energy_kwh::float AS energy_kwh,
         voltage::float    AS voltage
       FROM readings
       WHERE ${whereClause}
       ORDER BY timestamp ${sort.endsWith(':asc') ? 'ASC' : 'DESC'}
       LIMIT $${filterValues.length + 1} OFFSET $${filterValues.length + 2}`,
      dataValues
    );

    // 6. Links are relative to the request; req.baseUrl is
    //    '/installations/:id/readings' with the real id substituted.
    const basePath = req.baseUrl;
    const linkQuery = { ...req.query, limit };
    const nextLink = page < pages ? buildPageLink(page + 1, linkQuery, basePath) : null;
    const previous = page > 1 ? buildPageLink(page - 1, linkQuery, basePath) : null;

    res.json({
      data: readingsResult.rows,
      pagination: {
        total,
        page,
        limit,
        pages,
        next: nextLink,
        previous,
      },
    });
  } catch (err) {
    next(err);
  }
  }
);

// POST /installations/:id/readings
//
// AUTHENTICATION / AUTHORIZATION FLOW
//
//   1. authenticate                         -> no Authorization header
//                                              -> 401 { code: "NO_TOKEN" }
//                                           -> non-Bearer scheme
//                                              -> 401 { code: "INVALID_AUTH_HEADER" }
//                                           -> bad signature / expired / malformed
//                                              -> 401 { code: "INVALID_TOKEN" }
//                                           -> otherwise sets req.user and continues
//
//   2. requireScope('installation-write')    -> district token (scope
//                                              'analyst-read') never reaches the
//                                              handler -> 403 { code: "FORBIDDEN_SCOPE",
//                                              required: "installation-write" }
//
//   3. installation binding check            -> device token for installation A
//                                              posting to installation B
//                                              -> 403 { code: "FORBIDDEN_INSTALLATION" }
//
//   4. handler                               -> device token for installation A
//                                              posting to installation A -> 201
//
// Both checks run BEFORE any body validation or database work, so an
// unauthenticated caller cannot probe which timestamps already exist.
//
// This route is intentionally NOT gated by requireJurisdiction: that middleware
// rejects role 'device' outright, and a metering device is exactly who writes
// readings. The installation-scoped binding check in step 3 is the correct
// control here.
//
// Note on step 3: the String() coercion is deliberate. ids arrive as strings off
// the path params and as strings inside the JWT payload (JSON has no integer
// type), so a type-strict !== could reject a legitimate device if id types ever
// diverge between the token and the route.
router.post(
  '/',
  authenticate,
  requireScope('installation-write'),
  async (req, res, next) => {
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

    // 2. A device token may only write to its own installation. Without this, a
    //    correctly-scoped device could post readings to any site in the fleet.
    if (String(req.user.installation_id) !== String(req.params.id)) {
      return res.status(403).json({
        error: 'Device cannot write to another installation',
        code: 'FORBIDDEN_INSTALLATION',
      });
    }

    // 3. Validate the payload before touching the database.
    const validation = validateReadingBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_BODY',
        details: validation.errors,
      });
    }

    const { timestamp, power_kw, energy_kwh, voltage } = validation.value;

    // 4. Idempotency: one reading per (installation_id, timestamp). Checked up
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

    // 5. Generate the id and insert. RETURNING with `::float` casts gives the
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

    // 6. Location points at the new resource under the same mount path.
    res
      .status(201)
      .location(`${req.baseUrl}/${id}`)
      .json(inserted.rows[0]);
  } catch (err) {
    next(err);
  }
  }
);

module.exports = router;
