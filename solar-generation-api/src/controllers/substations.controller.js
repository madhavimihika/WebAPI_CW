const service = require('../services/substations.service');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

function allowedForUser(place, role, jurisdictionId) {
  return role === 'national' ||
    (role === 'provincial' && String(place.province_id) === String(jurisdictionId)) ||
    (role === 'district' && String(place.district_id) === String(jurisdictionId));
}

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
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });
    const substation = await service.findByIdWithJurisdiction(req.params.id);
    if (!substation) return res.status(404).json({ error: 'Substation not found' });
    if (!allowedForUser(substation, role, jurisdictionId)) return res.status(403).json({ error: 'Outside your jurisdiction', code: 'OUTSIDE_JURISDICTION' });
    const responseBody = { data: { id: substation.id, name: substation.name, district_id: substation.district_id } };
    setCacheHeaders(res, responseBody, new Date());
    if (checkConditional(req, res, generateETag(responseBody))) return;
    return res.json(responseBody);
  } catch (err) { return next(err); }
}

async function listInstallations(req, res, next) {
  try {
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });
    const substation = await service.findByIdWithJurisdiction(req.params.id);
    if (!substation) return res.status(404).json({ error: 'Substation not found' });
    if (!allowedForUser(substation, role, jurisdictionId)) return res.status(403).json({ error: 'Outside your jurisdiction', code: 'OUTSIDE_JURISDICTION' });
    const rows = await service.findInstallations(req.params.id);
    res.set('ETag', generateETag(rows));
    return res.json({ data: rows, total: rows.length });
  } catch (err) { return next(err); }
}

module.exports = { list, getById, listInstallations };
