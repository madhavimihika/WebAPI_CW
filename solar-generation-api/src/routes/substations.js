const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const controller = require('../controllers/substations.controller');

const router = express.Router();

router.get('/', authenticate, requireScope('analyst-read'), controller.list);
router.get('/:id/installations', authenticate, requireScope('analyst-read'), controller.listInstallations);
router.get('/:id', authenticate, requireScope('analyst-read'), controller.getById);

module.exports = router;
