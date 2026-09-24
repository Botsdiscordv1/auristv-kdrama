const { SearchResolver } = require('../resolvers/SearchResolver');
const { SearchMergeEngine } = require('../merge/SearchMergeEngine');
const { toAnimeCardDTO } = require('../dto/AnimeDTO');
const { toVisualDTO } = require('../dto/VisualDTO');

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();

class SearchAggregator {
  constructor() {
    this.resolver = new SearchResolver();
    this.mergeEngine = new SearchMergeEngine();
  }

  async search(query, category = 'all', options = {}) {
    const start = Date.now();
    this._log('SearchAggregator', 'start', { query, category });

    this._validate({ query, category });

    const cacheKey = `search:${category}:${query.toLowerCase().trim()}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      this._log('SearchAggregator', 'cache_hit', { cacheKey });
      return cached.data;
    }

    const rawResults = await this._resolve(query, category, options);

    const merged = this._merge(rawResults, query);

    const dto = this._buildDTO(merged, query, category);

    cache.set(cacheKey, { data: dto, timestamp: Date.now() });

    const duration = Date.now() - start;
    this._log('SearchAggregator', 'end', { duration, count: dto.totalResults });

    return dto;
  }

  async getAiringThisWeek() {
    const cacheKey = 'airing:this-week';
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const timetables = await this.resolver.search('', 'anime');
    if (!timetables?.length) return [];

    const byRoute = new Map();
    for (const e of timetables) {
      if (!byRoute.has(e.route) || e.episodeNumber > byRoute.get(e.route).episodeNumber) {
        byRoute.set(e.route, e);
      }
    }

    const data = [...byRoute.values()];
    cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  _validate({ query, category }) {
    if (category && !['anime', 'kdrama', 'peliculas', 'all'].includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }
  }

  async _resolve(query, category, options) {
    try {
      return await this.resolver.search(query, category, options);
    } catch (err) {
      this._log('SearchAggregator', 'SearchResolver error', err.message);
      return [];
    }
  }

  _merge(results, query) {
    return this.mergeEngine.merge(results, query);
  }

  _buildDTO(results, query, category) {
    return {
      query,
      page: 1,
      hasNextPage: false,
      totalResults: results.length,
      results: results.map(r => ({
        anime: toAnimeCardDTO(r),
        visuals: toVisualDTO(r),
        providers: [{
          providerId: r.source || 'unknown',
          providerName: r.source || 'Unknown',
          url: r.url || '',
          episodes: r.episodeCount || r.episodes || 0,
          language: r.language || 'sub',
          isPreferred: true,
        }],
        availableLanguages: r.language ? [r.language] : ['sub'],
        lastEpisode: r.episode || r.episodeCount || null,
        quality: r.quality || null,
      })),
    };
  }

  _log(aggregator, event, data) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${aggregator}] ${event}${data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''}`);
    }
  }
}

module.exports = { SearchAggregator };