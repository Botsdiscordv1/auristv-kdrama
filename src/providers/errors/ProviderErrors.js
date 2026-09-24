class ProviderError extends Error {
  constructor(message, code = 'PROVIDER_ERROR', retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

class ProviderTimeoutError extends ProviderError {
  constructor(message = 'Provider request timed out') {
    super(message, 'PROVIDER_TIMEOUT', true);
    this.name = 'ProviderTimeoutError';
  }
}

class ProviderRateLimitError extends ProviderError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, 'PROVIDER_RATE_LIMIT', true);
    this.name = 'ProviderRateLimitError';
    this.retryAfter = retryAfter;
  }
}

class ProviderUnavailableError extends ProviderError {
  constructor(message = 'Provider unavailable') {
    super(message, 'PROVIDER_UNAVAILABLE', true);
    this.name = 'ProviderUnavailableError';
  }
}

class ProviderParseError extends ProviderError {
  constructor(message = 'Failed to parse provider response') {
    super(message, 'PROVIDER_PARSE_ERROR', false);
    this.name = 'ProviderParseError';
  }
}

class ProviderAuthenticationError extends ProviderError {
  constructor(message = 'Provider authentication failed') {
    super(message, 'PROVIDER_AUTH_ERROR', false);
    this.name = 'ProviderAuthenticationError';
  }
}

class NotSupportedError extends ProviderError {
  constructor(method = 'Method') {
    super(`${method} not supported by this provider`, 'NOT_SUPPORTED', false);
    this.name = 'NotSupportedError';
  }
}

module.exports = {
  ProviderError,
  ProviderTimeoutError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  ProviderParseError,
  ProviderAuthenticationError,
  NotSupportedError,
};