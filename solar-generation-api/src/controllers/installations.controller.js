const service = require('../services/installations.service');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

function allowedForUser(site, role, jurisdictionId) {
  return role === 'national' ||
    (role === 'provincial' && String(site.province_id) === String(jurisdictionId)) ||
    (role === 'district' && String(site.district_id) === String(jurisdictionId));
}

async function list(req, res, next) {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });
    const rows = await service.findAllForRoleAndFilters(role, jurisdictionId, req.query);
    res.set('ETag', generateETag(rows));
    return res.json({ data: rows, total: rows.length });
  } catch (err) { return next(err); }
}

async function getLastKnownReading(req, res, next) {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });
    const site = await service.findParentWithJurisdiction(req.params.id);
    if (!site) return res.status(404).json({ error: 'Installation not found' });
    if (!allowedForUser(site, role, jurisdictionId)) return res.status(403).json({ error: 'Outside your jurisdiction', code: 'OUTSIDE_JURISDICTION' });
    const reading = await service.findLastReading(req.params.id);
    if (!reading) return res.status(404).json({ error: 'No readings for this installation', code: 'NOT_FOUND' });
    setCacheHeaders(res, reading, reading.timestamp);
    if (checkConditional(req, res, generateETag(reading))) return;
    return res.json(reading);
  } catch (err) { return next(err); }
}

async function getById(req, res, next) {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });
    const installation = await service.findByIdWithDetails(req.params.id);
    if (!installation) return res.status(404).json({ error: 'Installation not found' });
    if (!allowedForUser(installation, role, jurisdictionId)) return res.status(403).json({ error: 'Outside your jurisdiction', code: 'OUTSIDE_JURISDICTION' });
    const lastKnownReading = await service.findLastReading(req.params.id);
    const responseBody = { data: { ...installation, last_known_reading: lastKnownReading } };
    setCacheHeaders(res, responseBody, installation.created_at || new Date());
    if (checkConditional(req, res, generateETag(responseBody))) return;
    return res.json(responseBody);
  } catch (err) { return next(err); }
}

module.exports = { list, getLastKnownReading, getById };
