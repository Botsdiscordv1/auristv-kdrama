const { TMDBProvider } = require('../providers/tmdb/tmdb.provider');

function extractSeason(title = '') {
  const m = title.match(/(\d+)(?:st|nd|rd|th)?\s*(?:season|temporada|part|parte|cour)/i)
    || title.match(/(?:season|temporada|part|parte|cour)\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  const roman = title.match(/\b(II|III|IV|V|VI|VII|VIII|IX|X)\b/i);
  if (roman) {
    const map = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    return map[roman[1].toUpperCase()];
  }
  return null;
}

function stripSeasonSuffix(title = '') {
  return title
    .replace(/\s*\d+(?:st|nd|rd|th)?\s*(?:season|temporada|cour|part).*$/i, '')
    .replace(/\s*(?:ii|iii|iv|v|vi|vii|viii|ix|x)\s*[:–\-]?\s*.*$/i, '')
    .trim();
}

class BannerStrategy {
  constructor() {
    this.tmdb = new TMDBProvider();
  }

  async getBanner(title, existingBanner = null) {
    if (existingBanner && !existingBanner.includes('placeholder')) {
      return { url: existingBanner, source: 'provided', confidence: 100 };
    }

    const result = await this._searchTMDBWithFallback(title);
    if (result) return result;

    return null;
  }

  async enrichBatch(items) {
    const toEnrich = items.filter(r => !r.banner).slice(0, 20);
    if (!toEnrich.length) return;

    const results = await Promise.allSettled(
      toEnrich.map(item => this._findBestBanner(item.title))
    );

    for (let i = 0; i < toEnrich.length; i++) {
      const banner = results[i]?.status === 'fulfilled' ? results[i].value : null;
      if (banner?.url) toEnrich[i].banner = banner.url;
    }

    items.sort((a, b) => {
      if (a.banner && !b.banner) return -1;
      if (!a.banner && b.banner) return 1;
      return (b.score || 0) - (a.score || 0);
    });
  }

  async _findBestBanner(title) {
    const result = await this._searchTMDBWithFallback(title);
    if (result) return result;

    return null;
  }

  async _searchTMDBWithFallback(title) {
    const seasonNum = extractSeason(title);
    const queries = [...new Set([title, stripSeasonSuffix(title)].filter(Boolean))];

    for (const q of queries) {
      try {
        const { data } = await this.tmdb.client.get('/search/tv', {
          params: { query: q, language: 'es-MX' },
        });
        const results = data?.results || [];
        const best = results.find(r =>
          r.original_language === 'ja' && (r.genre_ids || []).includes(16)
        ) || results[0];
        if (!best) continue;

        if (seasonNum && best.id) {
          const seasonBanner = await this.tmdb.getSeasonImages(best.id, seasonNum);
          if (seasonBanner) {
            return { url: seasonBanner, source: 'tmdb_season', confidence: 90 };
          }
        }

        if (best.backdrop_path) {
          return {
            url: `https://image.tmdb.org/t/p/original${best.backdrop_path}`,
            source: 'tmdb_show',
            confidence: 80,
          };
        }
      } catch {}
    }

    return null;
  }
}

module.exports = { BannerStrategy };
