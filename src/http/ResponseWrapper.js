const { success, error } = require('../dto/ApiResponseDTO');
const { ERROR_CODES } = require('../dto/ApiErrorDTO');

function send(res, data, message = null, options = {}) {
  return res.json(success(data, message, { ...options, executionTimeMs: options.executionTimeMs ?? _elapsed(res) }));
}

function sendError(res, statusCode, message, code = ERROR_CODES.INTERNAL_ERROR, options = {}) {
  return res.status(statusCode).json(error(message, code, { ...options, executionTimeMs: options.executionTimeMs ?? _elapsed(res), retryable: statusCode >= 500 }));
}

function _elapsed(res) {
  if (res.locals?.startTime) {
    return Date.now() - res.locals.startTime;
  }
  return 0;
}

module.exports = { send, sendError };