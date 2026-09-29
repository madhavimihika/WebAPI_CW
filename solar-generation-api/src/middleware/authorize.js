/**
 * middleware/authorize.js
 * ---------------------------------------------------------------------------
 * Jurisdiction authorization: does this user's placement in the hierarchy
 * cover the district the request is aimed at?
 *
 *   national   -> always allowed
 *   provincial -> allowed if the district's province_id === user.jurisdiction_id
 *   district   -> allowed if the district id          === user.jurisdiction_id
 *   device     -> always rejected (device tokens cannot perform analyst reads)
 *
 * The district id is read from req.params.district_id, else req.params.id,
 * else req.query.district_id - first one found wins.
 *
 * Mount AFTER authenticate (it depends on req.user). The 500 below mirrors
 * requireScope's misuse guard so a wrong route definition fails loudly.
 *
 *   router.get('/:id', authenticate, requireJurisdiction, handler)
 */

const pool = require('../db');

/**
 * Pick the district id out of the request.
 * Returns null when none of the three supported locations carries a value.
 */
function resolveDistrictId(req) {
  const candidates = [
    req.params && req.params.district_id,
    req.params && req.params.id,
    req.query && req.query.district_id,
  ];

  for (const value of candidates) {
    // Treat empty string as absent so ?district_id= does not shadow a good
    // path parameter.
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

async function requireJurisdiction(req, res, next) {
  try {
    if (!req.user) {
      return res.status(500).json({
        error: 'Middleware misuse: authenticate must run first',
        code: 'SERVER_ERROR',
      });
    }

    const { role, jurisdiction_id: jurisdictionId } = req.user;

    // Device tokens are read-only installation reporters; they never get to
    // run analyst-style jurisdiction reads.
    if (role === 'device') {
      return res.status(403).json({
        error: 'Device tokens cannot perform analyst reads',
        code: 'FORBIDDEN_ROLE',
      });
    }

    const districtId = resolveDistrictId(req);

    if (districtId === null) {
      // Nothing to authorize against - the request never said which district
      // it means. Treated as a not-found rather than a 500.
      return res.status(404).json({
        error: 'District not found',
        code: 'NOT_FOUND',
      });
    }

    // Only provincial/district need the lookup; national short-circuits.
    if (role === 'national') {
      return next();
    }

    if (role !== 'provincial' && role !== 'district') {
      // Unknown role on the token. Fail closed.
      return res.status(403).json({
        error: 'Outside your jurisdiction',
        code: 'OUTSIDE_JURISDICTION',
      });
    }

    // Parameterized - districtId is never interpolated into the SQL text.
    const { rows } = await pool.query(
      'SELECT id, province_id FROM districts WHERE id = $1',
      [districtId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'District not found',
        code: 'NOT_FOUND',
      });
    }

    const district = rows[0];

    const allowed =
      role === 'provincial'
        ? String(district.province_id) === String(jurisdictionId)
        : String(district.id) === String(jurisdictionId);

    // Compare as strings: the JWT carries ids as strings (JSON), while pg
    // returns uuid columns as strings but integer columns as numbers. String
    // coercion keeps "3" === 3 working either way.
    if (!allowed) {
      return res.status(403).json({
        error: 'Outside your jurisdiction',
        code: 'OUTSIDE_JURISDICTION',
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireJurisdiction };
