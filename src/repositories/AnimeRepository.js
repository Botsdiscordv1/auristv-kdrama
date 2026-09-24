const { AnimeCache } = require('../cache/AnimeCache');
const { AnimeAggregator } = require('../aggregators/AnimeAggregator');

class AnimeRepository {
  constructor() {
    this.aggregator = new AnimeAggregator();
    this.detailCache = new AnimeCache(60 * 60 * 1000, 200);
  }

  async getDetail(title, malId = null, metadataTitle = null, year = null) {
    const cacheKey = malId ? `mal:${malId}` : `title:${(title || '').toLowerCase()}:${year}`;
    const cached = this.detailCache.get(cacheKey);
    if (cached) return cached;

    const detail = await this.aggregator.getDetail(title, malId, metadataTitle, year);
    if (detail) this.detailCache.set(cacheKey, detail);
    return detail;
  }

  async search(query) {
    return this.aggregator.search(query);
  }

  async getTrending(type = 'trending') {
    return this.aggregator.getTrending(type);
  }

  async getTrendingMovies() {
    return this.aggregator.getTrendingMovies();
  }
}

module.exports = { AnimeRepository };
