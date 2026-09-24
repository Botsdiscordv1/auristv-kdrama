/**
 * src/services/catalog/KdramaFilterService.js
 * Filtrado de kdramas por año a partir del catálogo SQLite persistente.
 * Complementa el search en vivo: el catálogo crece con el uso y este
 * endpoint sirve "ver más" sin re-scraping.
 */

const { getCatalogStore } = require('../../database/CatalogStore');
const { redisGet, redisSet } = require('../../cache/RedisCache');

const FILTER_RESULT_TTL_S = 10 * 60;
const filterMem = new Map(); // key -> { data, ts }

class KdramaFilterService {
  constructor(dbPath) {
    try {
      this.catalogStore = getCatalogStore(dbPath);
      this.db = this.catalogStore ? this.catalogStore.db : null;
    } catch {
      this.db = null;
    }
  }

  /**
   * Filtra el catálogo local por año y/o query de texto.
   * @param {Object} query - { year, page, limit, q }
   */
  async filterCatalog(query = {}) {
    const { year, q, page = 1, limit = 24 } = query;
    const yearNum = year ? parseInt(year, 10) : null;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 24, 1), 60);
    const text = (q || '').toString().toLowerCase().trim();

    const resultKey = `kdfilter:${yearNum || 'all'}:${text || 'all'}:p${pageNum}:${limitNum}`;
    const mem = filterMem.get(resultKey);
    if (mem && Date.now() - mem.ts < FILTER_RESULT_TTL_S * 1000) return mem.data;
    try {
      const redisData = await Promise.race([
        redisGet(resultKey),
        new Promise((r) => setTimeout(() => r(null), 800)),
      ]);
      if (redisData) {
        filterMem.set(resultKey, { data: redisData, ts: Date.now() });
        return redisData;
      }
    } catch { /* redis no disponible */ }

    let items = [];
    if (this.db) {
      try {
        let rows;
        if (yearNum && text) {
          rows = this.db.prepare(
            `SELECT c.* FROM catalog_items c
             JOIN catalog_titles t ON t.catalog_id = c.id
             WHERE c.kind = 'series' AND c.year = ? AND t.title_key LIKE ?
             GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
          ).all(yearNum, `%${text}%`, limitNum, (pageNum - 1) * limitNum);
        } else if (yearNum) {
          rows = this.db.prepare(
            `SELECT * FROM catalog_items WHERE kind = 'series' AND year = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`
          ).all(yearNum, limitNum, (pageNum - 1) * limitNum);
        } else if (text) {
          rows = this.db.prepare(
            `SELECT c.* FROM catalog_items c
             JOIN catalog_titles t ON t.catalog_id = c.id
             WHERE c.kind = 'series' AND t.title_key LIKE ?
             GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
          ).all(`%${text}%`, limitNum, (pageNum - 1) * limitNum);
        } else {
          rows = this.db.prepare(
            `SELECT * FROM catalog_items WHERE kind = 'series' ORDER BY updated_at DESC LIMIT ? OFFSET ?`
          ).all(limitNum, (pageNum - 1) * limitNum);
        }

        items = rows.map((r) => ({
          id: r.tmdb_id ? `tmdb:${r.tmdb_id}` : `db:${r.id}`,
          tmdbId: r.tmdb_id || null,
          title: r.title,
          originalTitle: r.original_title,
          poster: r.poster,
          backdrop: r.backdrop,
          year: r.year,
          score: r.score,
          kind: 'series',
          mediaType: 'tv',
          source: 'Catalog',
        }));
      } catch (e) {
        console.warn(`[KdramaFilter] db error: ${e.message}`);
      }
    }

    const result = {
      query: { year: yearNum, q: text, page: pageNum, limit: limitNum },
      count: items.length,
      page: pageNum,
      results: items,
    };
    filterMem.set(resultKey, { data: result, ts: Date.now() });
    redisSet(resultKey, result, FILTER_RESULT_TTL_S).catch(() => {});
    return result;
  }
}

let instance = null;
function getKdramaFilterService(dbPath) {
  if (!instance) instance = new KdramaFilterService(dbPath);
  return instance;
}

module.exports = { KdramaFilterService, getKdramaFilterService };
