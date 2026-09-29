/**
 * routes/auth.js
 * ---------------------------------------------------------------------------
 * Authentication endpoint.
 *
 *   POST /auth/login
 *     Body: { username, password }
 *     200 -> { token, token_type: "Bearer", expires_in: 3600, user: {...} }
 *     400 -> { error: "Validation failed", code: "INVALID_BODY", details: [...] }
 *     401 -> { error: "Invalid credentials", code: "INVALID_CREDENTIALS" }
 *
 * The 401 body is deliberately identical for "no such user" and "wrong
 * password" so the response cannot be used to enumerate valid usernames.
 *
 * That 401 also carries `WWW-Authenticate: Bearer realm="solar-api"` (RFC 6750
 * section 3), matching the 401s produced by middleware/auth.js - a client that
 * gets challenged here and retries there should see one consistent scheme.
 *
 * The JWT payload carries the caller's role/scope/jurisdiction/installation
 * so downstream middleware can authorise requests without a second DB hit.
 * password_hash is never read into the response.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

const TOKEN_TTL_SECONDS = 3600; // 1 hour

/**
 * Collect validation errors for the login body.
 * Only `username` and `password` are read; anything else in the body is
 * ignored rather than rejected.
 */
function validateLoginBody(body) {
  const details = [];
  const source = body && typeof body === 'object' ? body : {};

  if (typeof source.username !== 'string' || source.username.trim() === '') {
    details.push({
      field: 'username',
      message: 'username is required and must be a non-empty string',
    });
  }

  if (typeof source.password !== 'string' || source.password === '') {
    details.push({
      field: 'password',
      message: 'password is required and must be a non-empty string',
    });
  }

  return details;
}

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const details = validateLoginBody(req.body);

    if (details.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_BODY',
        details,
      });
    }

    // Parameterized lookup — never string-concatenate the username.
    const { rows } = await pool.query(
      `SELECT id, username, password_hash, role, scope,
              jurisdiction_level, jurisdiction_id, installation_id
         FROM users
        WHERE username = $1`,
      [req.body.username]
    );

    const user = rows[0];

    // Unknown user: still run a bcrypt comparison against a dummy hash so the
    // response time does not reveal whether the username exists.
    const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordMatches = await bcrypt.compare(req.body.password, hash);

    if (!user || !passwordMatches) {
      return res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="solar-api"')
        .json({
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS',
        });
    }

    // The `sub` claim must be a string for HS256 JWTs.
    const payload = {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      scope: user.scope,
      jurisdiction_level: user.jurisdiction_level ?? null,
      jurisdiction_id: user.jurisdiction_id ?? null,
      installation_id: user.installation_id ?? null,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: TOKEN_TTL_SECONDS,
    });

    return res.status(200).json({
      token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        scope: user.scope,
        jurisdiction_level: user.jurisdiction_level ?? null,
        jurisdiction_id: user.jurisdiction_id ?? null,
        installation_id: user.installation_id ?? null,
      },
    });
  } catch (err) {
    // Failed logins must not be cached by proxies.
    return next(err);
  }
});

module.exports = router;
