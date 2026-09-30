const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const { requireJurisdiction } = require('../middleware/authorize');
const controller = require('../controllers/districts.controller');

const router = express.Router();
router.get('/', authenticate, requireScope('analyst-read'), controller.list);
router.get('/:id', authenticate, requireScope('analyst-read'), requireJurisdiction, controller.getById);
router.get('/:id/substations', authenticate, requireScope('analyst-read'), requireJurisdiction, controller.listSubstations);
module.exports = router;
