const { toResponseMetadataDTO } = require('./ResponseMetadataDTO');
const { toApiErrorDTO } = require('./ApiErrorDTO');

function success(data, message = null, options = {}) {
  return {
    success: true,
    message,
    data: data ?? null,
    error: null,
    meta: toResponseMetadataDTO(options),
  };
}

function error(message, code = 'UNKNOWN_ERROR', options = {}) {
  return {
    success: false,
    message,
    data: null,
    error: toApiErrorDTO(code, message, options.details || null, options.retryable || false),
    meta: toResponseMetadataDTO(options),
  };
}

module.exports = { success, error };