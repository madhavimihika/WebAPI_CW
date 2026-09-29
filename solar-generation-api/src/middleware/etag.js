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
  if (req.headers['if-none-match'] === currentETag) {
    res.status(304).end();
    return true;
  }

  return false;
}

module.exports = { generateETag, setCacheHeaders, checkConditional };
