const crypto = require('crypto');
const service = require('../services/readings.service');
const { parsePagination, buildPagination } = require('../utils/pagination');
const { parseOptionalDate, buildFilters } = require('../utils/filtering');
const { parseSort } = require('../utils/sorting');

function validateReadingBody(body) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }
  let timestamp;
  if (body.timestamp === undefined || body.timestamp === null || body.timestamp === '') {
    errors.push({ field: 'timestamp', message: 'timestamp is required' });
  } else if (typeof body.timestamp !== 'string' && typeof body.timestamp !== 'number') {
    errors.push({ field: 'timestamp', message: 'timestamp must be a date string' });
  } else {
    const parsed = new Date(body.timestamp);
    if (Number.isNaN(parsed.getTime())) errors.push({ field: 'timestamp', message: 'timestamp must be a valid date' });
    else timestamp = parsed;
  }

  const numericFields = ['power_kw', 'energy_kwh', 'voltage'];
  const numbers = {};
  for (const field of numericFields) {
    const value = body[field];
    if (value === undefined || value === null) errors.push({ field, message: `${field} is required` });
    else if (typeof value !== 'number' || !Number.isFinite(value)) errors.push({ field, message: `${field} must be a number` });
    else numbers[field] = value;
  }
  if (errors.length) return { valid: false, errors };
  return { valid: true, value: { timestamp, ...numbers } };
}

async function getReadings(req, res, next) {
  try {
    const installationId = req.params.id;
    const { role, jurisdiction_id: jurisdictionId } = req.user;
    if (role === 'device') return res.status(403).json({ error: 'Device tokens cannot perform analyst reads', code: 'FORBIDDEN_ROLE' });

    const installation = await service.findInstallationSite(installationId);
    if (!installation.rows.length) return res.status(404).json({ error: 'Installation not found' });
    const site = installation.rows[0];
    const allowed = role === 'national' ||
      (role === 'provincial' && String(site.province_id) === String(jurisdictionId)) ||
      (role === 'district' && String(site.district_id) === String(jurisdictionId));
    if (!allowed) return res.status(403).json({ error: 'Outside your jurisdiction', code: 'OUTSIDE_JURISDICTION' });

    const sort = parseSort(req.query.sort);
    if (!sort) return res.status(400).json({ error: 'Invalid sort field', code: 'INVALID_SORT' });
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    if (!from.valid || !to.valid) return res.status(400).json({ error: 'Invalid date', code: 'INVALID_DATE' });
    let minPower;
    if (req.query.min_power !== undefined) {
      const rawMinPower = req.query.min_power;
      if (typeof rawMinPower !== 'string' || rawMinPower.trim() === '') return res.status(400).json({ error: 'Invalid min_power', code: 'INVALID_MIN_POWER' });
      minPower = Number(rawMinPower);
      if (!Number.isFinite(minPower)) return res.status(400).json({ error: 'Invalid min_power', code: 'INVALID_MIN_POWER' });
    }
    const pagination = parsePagination(req.query);
    if (!pagination.valid) return res.status(400).json({ error: 'Invalid page or limit', code: 'INVALID_PAGINATION' });

    const filter = buildFilters({ installationId, from: from.value, to: to.value, minPower });
    const countResult = await service.countReadings(filter.whereClause, filter.values);
    const total = countResult.rows[0].total;
    const readingsResult = await service.listReadings(filter.whereClause, sort, filter.values,
      filter.values.length, pagination.limit, pagination.offset);
    const linkQuery = { ...req.query, limit: pagination.limit };
    return res.json({
      data: readingsResult.rows,
      pagination: buildPagination(total, pagination.page, pagination.limit, linkQuery, req.baseUrl),
    });
  } catch (err) { return next(err); }
}

async function createReading(req, res, next) {
  try {
    const installationId = req.params.id;
    const installation = await service.findInstallation(installationId);
    if (!installation.rows.length) return res.status(404).json({ error: 'Installation not found' });
    if (String(req.user.installation_id) !== String(req.params.id)) {
      return res.status(403).json({ error: 'Device cannot write to another installation', code: 'FORBIDDEN_INSTALLATION' });
    }
    const validation = validateReadingBody(req.body);
    if (!validation.valid) return res.status(400).json({ error: 'Validation failed', code: 'INVALID_BODY', details: validation.errors });
    const { timestamp, power_kw, energy_kwh, voltage } = validation.value;
    const duplicate = await service.findReadingAt(installationId, timestamp);
    if (duplicate.rows.length) return res.status(409).json({ error: 'Reading already exists for this timestamp', code: 'DUPLICATE_READING' });
    const id = `read-${crypto.randomUUID()}`;
    const inserted = await service.insertReading(id, installationId, timestamp, power_kw, energy_kwh, voltage);
    res.set('ETag', `"${id}"`);
    res.set('Last-Modified', new Date(inserted.rows[0].timestamp).toUTCString());
    return res.status(201).location(`${req.baseUrl}/${id}`).json(inserted.rows[0]);
  } catch (err) { return next(err); }
}

module.exports = { getReadings, createReading };
