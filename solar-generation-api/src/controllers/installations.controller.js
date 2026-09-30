const service = require('../services/installations.service');
const { generateETag, setCacheHeaders, checkConditional } = require('../middleware/etag');

function validateInstallationBody(body) {
  const details = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, details: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }

  for (const field of ['site_name', 'meter_id', 'substation_id']) {
    if (typeof body[field] !== 'string' || body[field].trim() === '') {
      details.push({ field, message: `${field} is required and must be a non-empty string` });
    }
  }
  if (details.length) return { valid: false, details };
  return {
    valid: true,
    value: { site_name: body.site_name, meter_id: body.meter_id, substation_id: body.substation_id },
  };
}

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

async function create(req, res, next) {
  try {
    const validation = validateInstallationBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', code: 'INVALID_BODY', details: validation.details });
    }
    const { site_name, meter_id, substation_id } = validation.value;
    if (!(await service.substationExists(substation_id))) return res.status(404).json({ error: 'Substation not found' });
    if (await service.meterIdExists(meter_id)) {
      return res.status(409).json({ error: 'Meter ID already in use', code: 'DUPLICATE_METER_ID' });
    }

    const created = await service.createInstallation(site_name, meter_id, substation_id);
    if (created.duplicate) return res.status(409).json({ error: 'Meter ID already in use', code: 'DUPLICATE_METER_ID' });
    setCacheHeaders(res, created.record, new Date());
    return res.status(201).location(`${req.baseUrl}/${created.record.id}`).json(created.record);
  } catch (err) { return next(err); }
}

async function replace(req, res, next) {
  try {
    const validation = validateInstallationBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', code: 'INVALID_BODY', details: validation.details });
    }
    const current = await service.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Installation not found' });

    const ifMatch = req.get('If-Match');
    if (ifMatch !== undefined && ifMatch !== generateETag(current)) {
      return res.status(412).json({ error: 'Precondition failed', code: 'PRECONDITION_FAILED' });
    }

    const { site_name, meter_id, substation_id } = validation.value;
    if (!(await service.substationExists(substation_id))) return res.status(404).json({ error: 'Substation not found' });
    if (await service.meterIdExists(meter_id, current.id)) {
      return res.status(409).json({ error: 'Meter ID already in use', code: 'DUPLICATE_METER_ID' });
    }
    const updated = await service.updateInstallation(req.params.id, site_name, meter_id, substation_id);
    if (!updated) return res.status(404).json({ error: 'Installation not found' });
    setCacheHeaders(res, updated, new Date());
    return res.status(200).json(updated);
  } catch (err) { return next(err); }
}

async function remove(req, res, next) {
  try {
    const deleted = await service.deleteInstallationPreservingReadings(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Installation not found' });
    return res.status(200).json(deleted);
  } catch (err) { return next(err); }
}

module.exports = { list, getLastKnownReading, getById, create, replace, remove };
