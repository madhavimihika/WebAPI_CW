const service = require('../services/provinces.service');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

async function list(req, res, next) {
  try {
    const rows = await service.findAll();
    res.set('ETag', generateETag(rows));
    return res.json({ data: rows, total: rows.length });
  } catch (err) { return next(err); }
}

async function getById(req, res, next) {
  try {
    const province = await service.findById(req.params.id);
    if (!province) return res.status(404).json({ error: 'Province not found' });
    const responseBody = { data: province };
    setCacheHeaders(res, responseBody, new Date());
    if (checkConditional(req, res, generateETag(responseBody))) return;
    return res.json(responseBody);
  } catch (err) { return next(err); }
}

async function listDistricts(req, res, next) {
  try {
    const provinceId = req.params.id;
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    const province = await service.findById(provinceId);
    if (!province) return res.status(404).json({ error: 'Province not found' });
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });
    if (role === 'provincial' && String(jurisdictionId) !== String(provinceId)) {
      return res.status(403).json({ error: 'Outside your jurisdiction', code: 'OUTSIDE_JURISDICTION' });
    }
    if (role === 'district' && !(await service.findById(jurisdictionId))) {
      return res.status(403).json({ error: 'Outside your jurisdiction', code: 'OUTSIDE_JURISDICTION' });
    }
    const rows = await service.findDistrictsInProvince(provinceId);
    return res.json({ data: rows, total: rows.length });
  } catch (err) { return next(err); }
}

module.exports = { list, getById, listDistricts };
