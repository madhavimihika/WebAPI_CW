const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const controller = require('../controllers/provinces.controller');

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
