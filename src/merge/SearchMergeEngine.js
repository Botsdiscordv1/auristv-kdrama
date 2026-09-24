const { mergeSearchResults } = require('../../utils/search-merge');

const PROVIDER_PRIORITY = ['AnimeAV1', 'AnimeFLV', 'JKAnime'];

class SearchMergeEngine {
  merge(results, query = '') {
    if (!Array.isArray(results) || results.length === 0) return [];

    let merged = mergeSearchResults(results);

    if (merged.length > 1 && query) {
      merged = this._applyRelevance(merged, query);
    }

    merged = this._applyProviderPriority(merged);

    merged = this._sortResults(merged);

    return merged;
  }

  _applyRelevance(results, query) {
    const qLower = query.toLowerCase().trim();
    return results.sort((a, b) => {
      const aTitle = (a.title || '').toLowerCase();
      const bTitle = (b.title || '').toLowerCase();

      const aExact = aTitle === qLower ? 1 : 0;
      const bExact = bTitle === qLower ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      const aStarts = aTitle.startsWith(qLower) ? 1 : 0;
      const bStarts = bTitle.startsWith(qLower) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;

      return 0;
    });
  }

  _applyProviderPriority(results) {
    return results.map(item => {
      const priority = PROVIDER_PRIORITY.indexOf(item.source);
      return { ...item, providerPriority: priority >= 0 ? priority : 99 };
    });
  }

  _sortResults(results) {
    return results.sort((a, b) => {
      const aPrio = a.providerPriority ?? 99;
      const bPrio = b.providerPriority ?? 99;
      if (aPrio !== bPrio) return aPrio - bPrio;
      return 0;
    });
  }
}

module.exports = { SearchMergeEngine };