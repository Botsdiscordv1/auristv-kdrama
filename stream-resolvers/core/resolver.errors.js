'use strict';

const { ERROR_CODES } = require('./resolver.types');

class ResolverError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = Boolean(options.retryable);
    if (options.cause !== undefined) this.cause = options.cause;
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

class UnsupportedProviderError extends ResolverError {
  constructor(url) {
    super(ERROR_CODES.UNSUPPORTED_URL, `No supported resolver for URL ${url}`, { retryable: false });
    this.url = url;
  }
}

class InvalidSourceUrlError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.INVALID_URL, message || 'Invalid source URL', options);
  }
}

class SourceNotFoundError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.SOURCE_NOT_FOUND, message || 'Source not found (404)', options);
  }
}

class SourceUnavailableError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.SOURCE_UNAVAILABLE, message || 'Source unavailable', options);
  }
}

class ResolverBlockedError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.FORBIDDEN, message || 'Request forbidden', options);
  }
}

class ResolverTimeoutError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.TIMEOUT, message || 'Resolver request timed out', { retryable: true, ...options });
  }
}

class ResolverNetworkError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.NETWORK_ERROR, message || 'Resolver network error', { retryable: true, ...options });
  }
}

class ResolverRateLimitedError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.RATE_LIMITED, message || 'Resolver rate limited', { retryable: true, ...options });
  }
}

class ResolverParseError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.PARSER_ERROR, message || 'Failed to parse provider response', options);
  }
}

class TokenError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.TOKEN_ERROR, message || 'Failed to obtain a valid token', options);
  }
}

class SignatureError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.SIGNATURE_ERROR, message || 'Failed to generate a valid signature', options);
  }
}

class UpstreamError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.UPSTREAM_ERROR, message || 'Provider upstream error', { retryable: true, ...options });
  }
}

class StreamInvalidError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.STREAM_INVALID, message || 'Stream payload is invalid', options);
  }
}

class UnknownError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.UNKNOWN_ERROR, message || 'Unknown resolver error', options);
  }
}

class ResolverNotImplementedError extends ResolverError {
  constructor(providerId) {
    super(ERROR_CODES.NOT_IMPLEMENTED, `Resolver for provider "${providerId}" is not implemented yet`, { retryable: false });
  }
}

class ResolutionFailedError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.RESOLUTION_FAILED, message || 'Failed to resolve media URL', options);
  }
}

class UnsupportedMediaError extends ResolverError {
  constructor(message, options = {}) {
    super(ERROR_CODES.UNSUPPORTED_MEDIA, message || 'Media type not supported', { retryable: false, ...options });
  }
}

class SsrfDetectedError extends ResolverError {
  constructor(url) {
    super(ERROR_CODES.SSRF_DETECTED, `URL blocked by SSRF protection: ${url}`, { retryable: false });
  }
}

module.exports = {
  ResolverError,
  ResolverNotImplementedError,
  ResolutionFailedError,
  UnsupportedMediaError,
  UnsupportedProviderError,
  InvalidSourceUrlError,
  SourceNotFoundError,
  SourceUnavailableError,
  ResolverBlockedError,
  ResolverTimeoutError,
  ResolverNetworkError,
  ResolverRateLimitedError,
  ResolverParseError,
  TokenError,
  SignatureError,
  UpstreamError,
  StreamInvalidError,
  UnknownError,
  SsrfDetectedError,
};