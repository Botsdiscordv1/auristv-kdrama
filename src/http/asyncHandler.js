const { send, sendError } = require('./ResponseWrapper');

function asyncHandler(fn) {
  return async (req, res, next) => {
    const start = Date.now();
    try {
      const originalSend = res.json.bind(res);
      res.json = function (body) {
        if (body && typeof body === 'object' && body.meta) {
          body.meta.executionTimeMs = Date.now() - start;
        }
        return originalSend(body);
      };
      await fn(req, res, next);
    } catch (err) {
      const elapsed = Date.now() - start;
      sendError(res, 500, err.message, 'INTERNAL_ERROR', { executionTimeMs: elapsed });
    }
  };
}

module.exports = { asyncHandler };