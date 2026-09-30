function errorHandler(err, req, res, next) {
    console.error(err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        code: err.code || 'SERVER_ERROR',
    });
}

module.exports = errorHandler;