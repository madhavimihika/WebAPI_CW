const service = require('../services/districts.service');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

async function list(req, res, next) {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });
    const rows = await service.findAllForRole(role, jurisdictionId);
    res.set('ETag', generateETag(rows));
    return res.json({ data: rows, total: rows.length });
  } catch (err) { return next(err); }
}

async function getById(req, res, next) {
  try {
    const district = await service.findById(req.params.id);
    if (!district) return res.status(404).json({ error: 'District not found' });
    const responseBody = { data: district };
    setCacheHeaders(res, responseBody, new Date());
    if (checkConditional(req, res, generateETag(responseBody))) return;
    return res.json(responseBody);
  } catch (err) { return next(err); }
}

async function listSubstations(req, res, next) {
  try {
    if (!(await service.districtExists(req.params.id))) return res.status(404).json({ error: 'District not found' });
    const rows = await service.findSubstations(req.params.id);
    return res.json({ data: rows, total: rows.length });
  } catch (err) { return next(err); }
}

module.exports = { list, getById, listSubstations };
