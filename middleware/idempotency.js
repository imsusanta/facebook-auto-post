module.exports = function requireIdempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{16,128}$/.test(key))
    return res
      .status(400)
      .json({
        error: 'A stable Idempotency-Key header (16–128 characters) is required'
      });
  req.operationKey = key;
  next();
};
