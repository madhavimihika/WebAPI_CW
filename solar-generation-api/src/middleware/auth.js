/**
 * middleware/auth.js
 * ---------------------------------------------------------------------------
 * JWT authentication and scope authorization middleware.
 *
 *   authenticate            - verifies the bearer token, sets req.user
 *   requireScope(scope)     - factory; 403s if req.user.scope !== scope
 *
 * Usage:
 *   router.post('/', authenticate, requireScope('installation-write'), handler)
 *
 * Error codes are stable strings so clients can branch on them:
 *   401 NO_TOKEN             - no Authorization header at all
 *   401 INVALID_AUTH_HEADER  - header present but not a "Bearer ..." scheme
 *   401 INVALID_TOKEN        - signature/expiry/format failure
 *   403 FORBIDDEN_SCOPE      - authenticated, but wrong scope
 *   500 SERVER_ERROR         - authenticate skipped (developer error)
 */

const jwt = require('jsonwebtoken');

const AUTH_SCHEME = 'bearer ';

/**
 * Verify the bearer token and attach the decoded payload to req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'NO_TOKEN',
    });
  }

  // Scheme check is case-insensitive ("Bearer", "bearer", "BEARER").
  if (header.slice(0, AUTH_SCHEME.length).toLowerCase() !== AUTH_SCHEME) {
    return res.status(401).json({
      error: 'Invalid authorization header',
      code: 'INVALID_AUTH_HEADER',
    });
  }

  const token = header.slice(AUTH_SCHEME.length).trim();

  if (!token) {
    return res.status(401).json({
      error: 'Invalid authorization header',
      code: 'INVALID_AUTH_HEADER',
    });
  }

  try {
    // No algorithms option: jsonwebtoken infers the family from the token's
    // header, but it will not accept an unsigned "alg: none" token because we
    // pass a secret. Expiry is enforced automatically via the exp claim.
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (err) {
    // TokenExpiredError, JsonWebTokenError, NotBeforeError all collapse to the
    // same response - the client learns nothing about why it failed.
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
    });
  }
}

/**
 * Factory: returns middleware that allows only the given scope through.
 * Must be mounted after `authenticate`.
 */
function requireScope(scope) {
  return function requireScopeMiddleware(req, res, next) {
    if (!req.user) {
      // authenticate was not mounted, or was mounted after this. That is a bug
      // in the route definition, not a client error - say so loudly.
      return res.status(500).json({
        error: 'Middleware misuse: authenticate must run first',
        code: 'SERVER_ERROR',
      });
    }

    if (req.user.scope !== scope) {
      return res.status(403).json({
        error: 'Insufficient scope',
        code: 'FORBIDDEN_SCOPE',
        required: scope,
      });
    }

    return next();
  };
}

module.exports = { authenticate, requireScope };
