const { BaseProvider } = require('./BaseProvider');
const { NotSupportedError } = require('../errors/ProviderErrors');

const DEFAULT_CACHE_TTL = 300000;
const DEFAULT_MAX_REQUESTS = 120;
const DEFAULT_WINDOW_MS = 60000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_HALF_OPEN_TIMEOUT = 15000;

class ContentProvider extends BaseProvider {
  constructor(name, baseURL, options = {}) {
    super(name, baseURL, {
      timeout: options.timeout || 15000,
      headers: options.headers,
      cacheTTL: options.cacheTTL || DEFAULT_CACHE_TTL,
      maxRequests: options.maxRequests || DEFAULT_MAX_REQUESTS,
      windowMs: options.windowMs || DEFAULT_WINDOW_MS,
      failureThreshold: options.failureThreshold || DEFAULT_FAILURE_THRESHOLD,
      halfOpenTimeoutMs: options.halfOpenTimeoutMs || DEFAULT_HALF_OPEN_TIMEOUT,
      backoffBaseMs: options.backoffBaseMs || 500,
      backoffMaxAttempts: options.backoffMaxAttempts || 2,
    });

    this._serverAvailability = {};
  }

  async health() {
    const base = await super.health();
    return {
      ...base,
      type: 'content',
      serversAvailable: Object.keys(this._serverAvailability).length,
    };
  }

  async getServers(animeId, episodeId) {
    throw new NotSupportedError('getServers');
  }

  async getVideoUrl(serverId) {
    throw new NotSupportedError('getVideoUrl');
  }

  async searchEpisodes(animeId) {
    throw new NotSupportedError('searchEpisodes');
  }
}

module.exports = { ContentProvider };