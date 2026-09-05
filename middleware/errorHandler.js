const { randomUUID } = require('node:crypto');
module.exports = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const requestId = randomUUID();
  const status =
    err.type === 'entity.too.large'
      ? 413
      : err.name === 'MulterError'
        ? 400
        : err.statusCode || err.status || 500;
  // Do not log messages, request bodies, URLs with query strings, or upstream error objects.
  console.error(
    JSON.stringify({
      event: 'request_failed',
      requestId,
      method: req.method,
      status
    })
  );
  res
    .status(status >= 400 && status <= 599 ? status : 500)
    .json({
      success: false,
      error: err.expose
        ? err.message
        : status === 413
          ? 'Request too large'
          : status < 500
            ? 'Invalid request'
            : 'Request failed. Please try again.',
      requestId
    });
};
