const { BaseProvider } = require('./BaseProvider');

const DEFAULT_CACHE_TTL = 1800000;
const DEFAULT_MAX_REQUESTS = 30;
const DEFAULT_WINDOW_MS = 60000;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_HALF_OPEN_TIMEOUT = 30000;

class MetadataProvider extends BaseProvider {
  constructor(name, baseURL, options = {}) {
    super(name, baseURL, {
      timeout: options.timeout || 10000,
      headers: options.headers,
      cacheTTL: options.cacheTTL || DEFAULT_CACHE_TTL,
      maxRequests: options.maxRequests || DEFAULT_MAX_REQUESTS,
      windowMs: options.windowMs || DEFAULT_WINDOW_MS,
      failureThreshold: options.failureThreshold || DEFAULT_FAILURE_THRESHOLD,
      halfOpenTimeoutMs: options.halfOpenTimeoutMs || DEFAULT_HALF_OPEN_TIMEOUT,
      backoffBaseMs: options.backoffBaseMs || 1000,
      backoffMaxAttempts: options.backoffMaxAttempts || 3,
    });

    this._dataFreshness = {};
  }

  async health() {
    const base = await super.health();
    return {
      ...base,
      type: 'metadata',
      cacheHitRate: this._cacheHitRate(),
      dataFreshness: this._dataFreshness,
    };
  }

  _cacheHitRate() {
    const total = this._stats.cacheHits + this._stats.cacheMisses;
    return total === 0 ? null : (this._stats.cacheHits / total) * 100;
  }
}

module.exports = { MetadataProvider };