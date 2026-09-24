const SOURCES = require('../../sources');

class SearchService {
  async searchAllSources(query, category, options = {}) {
    const fuentes = SOURCES.filter(s => {
      if (s.enabled === false) return false;
      if (category === 'all') return true;
      return s.categoria === category;
    });

    if (!fuentes.length) return [];

    const axios = require('axios');
    const cheerio = require('cheerio');

    const resultsNested = await Promise.all(
      fuentes.map(s => this._searchSource(s, query, axios, cheerio, options))
    );
    return resultsNested.flat();
  }

  async _searchSource(source, query, axios, cheerio, options = {}) {
    try {
      const results = await source.search(query, axios, cheerio, options);
      return results.map(r => ({ ...r, source: source.name }));
    } catch {
      return [];
    }
  }
}

module.exports = { SearchService };