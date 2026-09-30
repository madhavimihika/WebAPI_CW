function notFound(req, res) {
    res.status(404).json({
        error: 'Resource not found',
        code: 'NOT_FOUND',
        path: req.originalUrl,
    });
}

module.exports = notFound;