const crypto = require('crypto');

function generateETag(obj) {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(obj))
    .digest('hex')
    .slice(0, 12);
  return `"${hash}"`;
}

function setCacheHeaders(res, obj, lastModifiedDate) {
  res.set('ETag', generateETag(obj));
  res.set('Last-Modified', new Date(lastModifiedDate).toUTCString());
}

function checkConditional(req, res, currentETag) {
  const clientETag = req.headers['if-none-match'];
  if (!clientETag) return false;

  const normalize = (tag) => String(tag).trim().replace(/^W\//, '');
  const current = normalize(currentETag);
  const matches = clientETag === '*'
    || String(clientETag).split(',').some((tag) => normalize(tag) === current);

  if (matches) {
    res.status(304).end();
    return true;
  }

  return false;
}

module.exports = { generateETag, setCacheHeaders, checkConditional };
