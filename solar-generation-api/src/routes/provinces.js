const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const controller = require('../controllers/provinces.controller');

const router = express.Router();
router.get('/', authenticate, requireScope('analyst-read'), controller.list);
router.get('/:id', authenticate, requireScope('analyst-read'), controller.getById);
router.get('/:id/districts', authenticate, requireScope('analyst-read'), controller.listDistricts);
module.exports = router;
