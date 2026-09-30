function parseOptionalDate(value) {
  if (value === undefined) return { valid: true };
  if (typeof value !== 'string' || value.trim() === '') return { valid: false };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { valid: false } : { valid: true, value: date };
}

// Adds supported location and time filters using values rather than SQL text.
function buildFilters({ installationId, provinceId, districtId, substationId, from, to, minPower }, values = []) {
  const clauses = [];
  const add = (column, value, operator = '=') => {
    if (value !== undefined) {
      values.push(value);
      clauses.push(`${column} ${operator} $${values.length}`);
    }
  };
  add('installation_id', installationId);
  add('province_id', provinceId);
  add('district_id', districtId);
  add('substation_id', substationId);
  add('timestamp', from, '>=');
  add('timestamp', to, '<=');
  add('power_kw', minPower, '>=');
  return { clauses, values, whereClause: clauses.join(' AND ') };
}

module.exports = { parseOptionalDate, buildFilters };
