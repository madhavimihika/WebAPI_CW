const SORT_FIELDS = Object.freeze({ timestamp: 'timestamp' });

function parseSort(value) {
  if (value === undefined) value = 'timestamp:desc';
  if (value !== 'timestamp:asc' && value !== 'timestamp:desc') return null;
  const [field, direction] = value.split(':');
  if (!Object.prototype.hasOwnProperty.call(SORT_FIELDS, field)) return null;
  return { column: SORT_FIELDS[field], direction: direction.toUpperCase() };
}

module.exports = { parseSort };
