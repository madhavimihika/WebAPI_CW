const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePositiveInt(value, fallback) {
  if (value === undefined) return { value: fallback, valid: true };
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return { valid: false };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return { valid: false };
  return { value: parsed, valid: true };
}

function parsePagination(query) {
  const parsedPage = parsePositiveInt(query.page, DEFAULT_PAGE);
  const parsedLimit = parsePositiveInt(query.limit, DEFAULT_LIMIT);
  if (!parsedPage.valid || !parsedLimit.valid) return { valid: false };
  const page = parsedPage.value;
  const limit = Math.min(parsedLimit.value, MAX_LIMIT);
  return { valid: true, page, limit, offset: (page - 1) * limit };
}

function buildPageLink(page, query, basePath) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  params.set('page', String(page));
  return `${basePath}?${params.toString()}`;
}

function buildPagination(total, page, limit, query, basePath) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return {
    total,
    page,
    limit,
    pages,
    next: page < pages ? buildPageLink(page + 1, query, basePath) : null,
    previous: page > 1 ? buildPageLink(page - 1, query, basePath) : null,
  };
}

module.exports = { parsePagination, buildPageLink, buildPagination };
