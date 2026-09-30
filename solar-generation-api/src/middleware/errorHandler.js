// Preserve the API's existing 500 response while centralizing error handling.
function errorHandler(err, req, res, next) {
  console.error(err);
  return res.status(500).json({ error: err.message });
}

module.exports = errorHandler;
