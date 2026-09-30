const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const controller = require('../controllers/readings.controller');

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, requireScope('analyst-read'), controller.getReadings);
router.post('/', authenticate, requireScope('installation-write'), controller.createReading);

module.exports = router;
