const axios = require('axios');
const { ProviderTimeoutError, ProviderRateLimitError } = require('../errors/ProviderErrors');

const DEFAULT_TIMEOUT = 10000;
const MAX_RETRIES = 2;

function createClient(baseURL, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const headers = options.headers || {};

  const client = axios.create({
    baseURL,
    timeout,
    headers: { Accept: 'application/json', ...headers },
    validateStatus: status => status < 500,
  });

  client.interceptors.response.use(
    response => response,
    async error => {
      if (error.code === 'ECONNABORTED') {
        throw new ProviderTimeoutError(`Request to ${baseURL} timed out after ${timeout}ms`);
      }
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'], 10) || null;
        throw new ProviderRateLimitError('Rate limit exceeded', retryAfter);
      }
      throw error;
    }
  );

  return client;
}

module.exports = { createClient };