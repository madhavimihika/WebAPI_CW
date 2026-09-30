const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authService = require('../services/auth.service');

const TOKEN_TTL_SECONDS = 3600;

function validateLoginBody(body) {
  const details = [];
  const source = body && typeof body === 'object' ? body : {};
  if (typeof source.username !== 'string' || source.username.trim() === '') {
    details.push({ field: 'username', message: 'username is required and must be a non-empty string' });
  }
  if (typeof source.password !== 'string' || source.password === '') {
    details.push({ field: 'password', message: 'password is required and must be a non-empty string' });
  }
  return details;
}

async function login(req, res, next) {
  try {
    const details = validateLoginBody(req.body);
    if (details.length) return res.status(400).json({ error: 'Validation failed', code: 'INVALID_BODY', details });

    const user = await authService.findUserByUsername(req.body.username);
    // Compare unknown users against a dummy hash to reduce username timing leaks.
    const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordMatches = await bcrypt.compare(req.body.password, hash);
    if (!user || !passwordMatches) {
      return res.status(401).set('WWW-Authenticate', 'Bearer realm="solar-api"').json({
        error: 'Invalid credentials', code: 'INVALID_CREDENTIALS',
      });
    }

    const payload = {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      scope: user.scope,
      jurisdiction_level: user.jurisdiction_level ?? null,
      jurisdiction_id: user.jurisdiction_id ?? null,
      installation_id: user.installation_id ?? null,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS });
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
  } catch (err) { return next(err); }
}

module.exports = { login };
