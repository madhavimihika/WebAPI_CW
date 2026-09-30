/**
 * routes/provinces.js
 * ---------------------------------------------------------------------------
 * Province endpoints.
 *
 *   GET /provinces             -> { data: [...], total: N }  (all provinces, ordered by name)
 *   GET /provinces/:id         -> one province, or 404 { error: "Province not found" }
 *   GET /provinces/:id/districts -> districts in that province
 *                                   404 if the province does not exist,
 *                                   { data: [], total: 0 } if it has none
 *
 * AUTHORIZATION
 *   Every GET on this router requires a bearer token carrying the
 *   'analyst-read' scope:
 *
 *     authenticate -> 401 { code: "NO_TOKEN" | "INVALID_AUTH_HEADER" | "INVALID_TOKEN" }
 *     requireScope('analyst-read') -> 403 { code: "FORBIDDEN_SCOPE" }
 *
 *   Jurisdiction is enforced inside the handlers rather than with the shared
 *   requireJurisdiction middleware, because that middleware authorizes against
 *   a DISTRICT id (req.params.id) and everything here is addressed by PROVINCE
 *   id. There is no province -> district mapping for it to do.
 *
 *   GET /provinces  and  GET /provinces/:id  are the two ways a client learns
 *   the id space, so they stay open to any analyst-read holder - including a
 *   district user, who needs the province of their own district to make sense
 *   of the data. The confinement happens one level down, on the district list.
 *
 *   GET /provinces/:id/districts is the first endpoint that returns records a
 *   caller might not be entitled to, so it is the first that is jurisdiction
 *   checked (see the handler for the exact rule).
 *
 * All SQL lives in the model layer (../models/provinces); this file only calls
 * it and turns the results into responses. Errors are passed to next(err) and
 * handled by the central error handler in app.js.
 */

const express = require('express');
const {
  findAll,
  findById,
  findDistrictsInProvince,
} = require('../models/provinces');
const { authenticate, requireScope } = require('../middleware/auth');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

const router = express.Router();

// GET /provinces
router.get('/', authenticate, requireScope('analyst-read'), async (req, res, next) => {
  try {
    const rows = await findAll();
    res.set('ETag', generateETag(rows));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /provinces/:id
router.get('/:id', authenticate, requireScope('analyst-read'), async (req, res, next) => {
  try {
    const province = await findById(req.params.id);

    if (province === null) {
      return res.status(404).json({ error: 'Province not found' });
    }

    const responseBody = { data: province };
    const etag = generateETag(responseBody);
    setCacheHeaders(res, responseBody, new Date());
    if (checkConditional(req, res, etag)) {
      return;
    }
    return res.json(responseBody);
  } catch (err) {
    next(err);
  }
});

// GET /provinces/:id/districts
router.get(
  '/:id/districts',
  authenticate,
  requireScope('analyst-read'),
  async (req, res, next) => {
    try {
      const provinceId = req.params.id;
      const { role, jurisdiction_id: jurisdictionId } = req.user;

      // 1. The province must exist. This also gives a cheap 404 before any
      //    jurisdiction decision is made, so "no such province" stays
      //    distinguishable from "exists but is empty" (200 + []).
      const province = await findById(provinceId);

      if (province === null) {
        return res.status(404).json({ error: 'Province not found' });
      }

      // 2. Jurisdiction.
      //
      //    national   -> any province
      //    provincial -> only the province named by their jurisdiction_id
      //    district   -> only if their own district lives inside this province
      //    device     -> always rejected (has read scope, is not an analyst)
      //
      //    role/jurisdictionId are compared as strings: the JWT carries ids as
      //    strings (JSON has no integer type) and the schema stores every id as
      //    TEXT, but String() keeps this correct if that ever changes.
      if (role === 'device') {
        return res.status(403).json({
          error: 'Device tokens cannot perform analyst reads',
          code: 'FORBIDDEN_ROLE',
        });
      }

      if (role === 'provincial' && String(jurisdictionId) !== String(provinceId)) {
        return res.status(403).json({
          error: 'Outside your jurisdiction',
          code: 'OUTSIDE_JURISDICTION',
        });
      }

      if (role === 'district') {
        // Does the caller's own district sit inside this province? One row
        // proves it; no row covers both "wrong province" and "no such
        // district on the token".
        const ownDistrict = await findById(jurisdictionId);

        if (ownDistrict === null) {
          return res.status(403).json({
            error: 'Outside your jurisdiction',
            code: 'OUTSIDE_JURISDICTION',
          });
        }
      }

      const rows = await findDistrictsInProvince(provinceId);

      res.set('ETag', generateETag(rows));
      res.json({ data: rows, total: rows.length });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
