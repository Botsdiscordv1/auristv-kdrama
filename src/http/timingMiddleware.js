function timingMiddleware(req, res, next) {
  const start = Date.now();
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (body && typeof body === 'object' && body.meta) {
      body.meta.executionTimeMs = Date.now() - start;
    }
    return originalJson(body);
  };
  next();
}

module.exports = { timingMiddleware };