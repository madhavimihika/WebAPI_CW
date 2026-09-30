const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const controller = require('../controllers/installations.controller');

const router = express.Router();
router.get('/', authenticate, requireScope('analyst-read'), controller.list);
// This longer path must come before /:id so Express matches the readings resource.
router.get('/:id/last-known-reading', authenticate, requireScope('analyst-read'), controller.getLastKnownReading);
router.get('/:id', authenticate, requireScope('analyst-read'), controller.getById);
module.exports = router;
