const { HomeResolver } = require('../resolvers/HomeResolver');
const { VisualResolver } = require('../resolvers/VisualResolver');
const { BannerResolver } = require('../resolvers/BannerResolver');
const { RecommendationResolver } = require('../resolvers/RecommendationResolver');
const { toAnimeCardDTO } = require('../dto/AnimeDTO');
const { toVisualDTO } = require('../dto/VisualDTO');

const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();

class HomeAggregator {
  constructor() {
    const { AniListProvider } = require('../providers/anilist/anilist.provider');
    const { TMDBProvider } = require('../providers/tmdb/tmdb.provider');

    const anilist = new AniListProvider();
    const tmdb = new TMDBProvider();

    this.homeResolver = new HomeResolver(anilist);
    this.visualResolver = new VisualResolver(tmdb);
    this.bannerResolver = new BannerResolver(this.visualResolver);
    this.recommendationResolver = new RecommendationResolver();
  }

  async getHome(locale = 'es-MX') {
    const start = Date.now();
    this._log('HomeAggregator', 'start', { locale });

    const cacheKey = `home:${locale}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      this._log('HomeAggregator', 'cache_hit');
      return cached.data;
    }

    const sections = await this._resolveSections(locale);

    const dto = this._buildDTO(sections);

    cache.set(cacheKey, { data: dto, timestamp: Date.now() });

    const duration = Date.now() - start;
    this._log('HomeAggregator', 'end', { duration, sections: dto.sections.length });

    return dto;
  }

  async _resolveSections(locale) {
    const trendingPromise = this._resolveTrendingSection(locale);
    const recommendationsPromise = this._resolveRecommendationsSection();

    const results = await Promise.allSettled([
      trendingPromise,
      recommendationsPromise,
    ]);

    const sections = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        sections.push(r.value);
      }
    }

    return sections;
  }

  async _resolveTrendingSection(locale) {
    try {
      const items = await this.homeResolver.getTrending();

      if (!items?.length) return null;

      const enriched = items.slice(0, 30).map(item => {
      const anime = toAnimeCardDTO(item);
      const visuals = toVisualDTO(item);
      return { anime, visuals, progress: null, reason: null };
    });

    const toEnrich = enriched.filter(r => !r.visuals.banner).slice(0, 20);
    if (toEnrich.length) {
      await this.bannerResolver.enrichBatch(toEnrich.map(e => ({
        title: e.anime.title,
        banner: e.visuals.banner,
      })));
      for (let i = 0; i < toEnrich.length; i++) {
        const enrichedItem = toEnrich[i];
        const matchingItem = enriched.find(e => e.anime.title === enrichedItem.title);
        if (matchingItem && enrichedItem.banner) {
          matchingItem.visuals.banner = enrichedItem.banner;
        }
      }
    }

    return {
      id: 'trending',
      title: 'Tendencia',
      subtitle: 'Lo más popular',
      type: 'anime',
      layout: 'poster',
      order: 0,
      items: enriched,
    };
  } catch (err) {
    this._log('HomeAggregator', 'Trending section error', err.message);
    return null;
  }
}

async _resolveRecommendationsSection() {
  try {
    const items = await this.recommendationResolver.resolve();
    if (!items?.length) return null;

    return {
      id: 'recommendations',
      title: 'Recomendaciones',
      subtitle: 'Basado en tu historial',
      type: 'anime',
      layout: 'poster',
      order: 1,
      items: items.map(item => ({
        anime: toAnimeCardDTO(item),
          visuals: toVisualDTO(item),
          progress: null,
          reason: null,
        })),
      };
    } catch {
      return null;
    }
  }

  _buildDTO(sections) {
    return {
      generatedAt: new Date().toISOString(),
      sections: sections
        .filter(s => s && s.items?.length)
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        .map(s => ({
          id: s.id,
          title: s.title,
          subtitle: s.subtitle,
          type: s.type,
          layout: s.layout,
          order: s.order,
          items: s.items,
        })),
    };
  }

  _log(aggregator, event, data) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${aggregator}] ${event}${data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''}`);
    }
  }
}

module.exports = { HomeAggregator };