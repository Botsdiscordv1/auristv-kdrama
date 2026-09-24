const axios = require('axios');
const cheerio = require('cheerio');

const SOURCES = require('../../sources');

class SearchResolver {
  async search(query, category = 'all', options = {}) {
    const fuentes = SOURCES.filter(s => {
      if (s.enabled === false) return false;
      if (category === 'all') return true;
      return s.categoria === category;
    });

    if (!fuentes.length) return [];

    const results = await Promise.allSettled(
      fuentes.map(s => this._searchSource(s, query))
    );

    const allResults = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.length) {
        allResults.push(...r.value);
      }
    }

    return allResults;
  }

  async _searchSource(source, query) {
    try {
      const results = await source.search(query, axios, cheerio);
      return results.map(r => ({ ...r, source: source.name }));
    } catch {
      return [];
    }
  }
}

module.exports = { SearchResolver };