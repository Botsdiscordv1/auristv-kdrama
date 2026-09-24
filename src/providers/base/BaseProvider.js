const { NotSupportedError } = require('../errors/ProviderErrors');
const { createClient } = require('../http/HttpClientFactory');
const { ProviderCache } = require('../cache/ProviderCache');
const { RateLimiter } = require('../ratelimit/RateLimiter');
const { CircuitBreaker } = require('../circuitbreaker/CircuitBreaker');
const { Backoff } = require('../backoff/Backoff');

class BaseProvider {
  constructor(name, baseURL, options = {}) {
    this.name = name;

    const timeout = options.timeout || 10000;
    const headers = options.headers || {};

    this.client = createClient(baseURL, { timeout, headers });
    this._initialized = false;

    this._cache = new ProviderCache(name, options.cacheTTL || 300000);
    this._rateLimiter = new RateLimiter(name, options.maxRequests || 60, options.windowMs || 60000);
    this._circuitBreaker = new CircuitBreaker(name, {
      failureThreshold: options.failureThreshold || 5,
      halfOpenTimeoutMs: options.halfOpenTimeoutMs || 30000,
    });
    this._backoff = new Backoff({
      baseMs: options.backoffBaseMs || 500,
      maxAttempts: options.backoffMaxAttempts || 3,
    });

    this._stats = {
      lastSuccess: null,
      lastFailure: null,
      totalRequests: 0,
      totalErrors: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };

    this._abortControllers = new Set();
  }

  async initialize() {
    this._initialized = true;
  }

  _onError(err) {
    // Gancho de error por defecto. Puede ser sobrescrito por clases hijas.
    console.warn(`[BaseProvider: ${this.name}] Error detectado: ${err.message}`);
  }

  async health() {
    return {
      name: this.name,
      status: this._healthStatus(),
      responseTime: null,
      lastSuccess: this._stats.lastSuccess,
      lastFailure: this._stats.lastFailure,
      version: '1.0.0',
      circuitBreakerState: this._circuitBreaker.state,
      cacheSize: this._cache.size,
      rateLimiterRemaining: this._rateLimiter.remaining,
    };
  }

  _healthStatus() {
    if (!this._initialized) return 'OFFLINE';
    if (this._circuitBreaker.isOpen) return 'DEGRADED';
    return 'ONLINE';
  }

  async search(query, page) {
    throw new NotSupportedError('search');
  }

  async details(id) {
    throw new NotSupportedError('details');
  }

  async close() {
    this.cancel();
    this._initialized = false;
  }

  async _executeRequest(fn, cacheKeyParts = null, ttlMs = null) {
    if (!this._initialized) {
      await this.initialize();
    }

    if (cacheKeyParts) {
      const cached = this._cache.get(cacheKeyParts);
      if (cached !== null) {
        this._stats.cacheHits++;
        return cached;
      }
      this._stats.cacheMisses++;
    }

    await this._rateLimiter.acquire();

    const abortController = new AbortController();
    this._abortControllers.add(abortController);

    let lastError = null;
    for (let attempt = 0; attempt < this._backoff.maxAttempts; attempt++) {
      try {
        const result = await this._circuitBreaker.call(async () => {
          this._stats.totalRequests++;
          return await fn(abortController.signal);
        });

        this._abortControllers.delete(abortController);
        this._stats.lastSuccess = new Date().toISOString();
        if (cacheKeyParts) {
          this._cache.set(cacheKeyParts, result, ttlMs);
        }
        return result;
      } catch (err) {
        this._abortControllers.delete(abortController);
        lastError = err;
        this._stats.totalErrors++;
        this._stats.lastFailure = new Date().toISOString();
        this._onError(err);

        if (!err.retryable) throw err;
        if (err.code === 'PROVIDER_AUTH_ERROR') throw err;

        const canRetry = await this._backoff.wait(attempt);
        if (!canRetry) break;
      }
    }

    throw lastError;
  }

  cancel() {
    for (const ac of this._abortControllers) {
      ac.abort();
    }
    this._abortControllers.clear();
  }
}

module.exports = { BaseProvider };