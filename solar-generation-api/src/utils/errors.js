// Create a consistent internal error description for callers and logs.
function createError(code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return error;
}

module.exports = { createError };
