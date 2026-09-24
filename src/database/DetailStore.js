/**
 * src/database/DetailStore.js
 * Manejador de persistencia de detalles DTO para Películas y Series.
 */

const { getCatalogStore, normalizeKey } = require('./CatalogStore');
const { LocalDatabase } = require('./LocalDatabase');

class DetailStore {
  constructor(dbPath) {
    this.catalogStore = getCatalogStore(dbPath);
    this.localDb = LocalDatabase.getDatabase(dbPath);
    this.db = this.localDb.db;
  }

  resolveCatalogId({ tmdbId, mediaType, title, year } = {}) {
    if (tmdbId && mediaType) {
      const row = this.db.prepare('SELECT id FROM catalog_items WHERE tmdb_id = ? AND media_type = ?').get(parseInt(tmdbId, 10), mediaType);
      if (row) return row.id;
    }
    if (title) {
      const key = normalizeKey(title);
      if (key) {
        const row = this.db.prepare('SELECT catalog_id FROM catalog_titles WHERE title_key = ? LIMIT 1').get(key);
        if (row) return row.catalog_id;
      }
    }
    return null;
  }

  saveDetail(catalogId, season = 1, dataDTO = {}, args = '') {
    if (!catalogId || !dataDTO) return false;
    const seasonVal = parseInt(season, 10) || 1;
    const jsonStr = JSON.stringify(dataDTO);
    const now = Date.now();
    const backdropPath = dataDTO.backdrop || null;

    try {
      const existing = this.db.prepare('SELECT catalog_id FROM item_detail WHERE catalog_id = ? AND season = ?').get(catalogId, seasonVal);
      if (existing) {
        this.db.prepare(`
          UPDATE item_detail
          SET data = ?, args = ?, refreshed_at = ?, updated_at = ?, backdrop_path = ?
          WHERE catalog_id = ? AND season = ?
        `).run(jsonStr, args, now, now, backdropPath, catalogId, seasonVal);
      } else {
        this.db.prepare(`
          INSERT INTO item_detail (catalog_id, season, data, args, refreshed_at, created_at, updated_at, backdrop_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(catalogId, seasonVal, jsonStr, args, now, now, now, backdropPath);
      }
      return true;
    } catch (err) {
      console.error('[DetailStore] Error saving detail:', err.message);
      return false;
    }
  }

  getDetail(catalogId, season = 1) {
    if (!catalogId) return null;
    const seasonVal = parseInt(season, 10) || 1;
    try {
      const row = this.db.prepare('SELECT data, refreshed_at, updated_at FROM item_detail WHERE catalog_id = ? AND season = ?').get(catalogId, seasonVal);
      if (!row || !row.data) return null;
      const data = JSON.parse(row.data);
      return {
        data,
        refreshedAt: row.refreshed_at,
        updatedAt: row.updated_at,
        isStale: this._isFieldStale(data, row.refreshed_at),
      };
    } catch {
      return null;
    }
  }

  /**
   * Evalúa si los datos están incompletos o desactualizados (> 30 días o faltan visuales clave).
   */
  _isFieldStale(data = {}, refreshedAt = 0) {
    if (!refreshedAt) return true;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - refreshedAt > THIRTY_DAYS) return true;

    // Faltan imágenes clave que podrían haberse obtenido después
    if (!data.poster && !data.backdrop) return true;
    if (!data.genres || data.genres.length === 0) return true;

    return false;
  }
}

let detailStoreInstance = null;
function getDetailStore(dbPath) {
  if (!detailStoreInstance) {
    detailStoreInstance = new DetailStore(dbPath);
  }
  return detailStoreInstance;
}

module.exports = { DetailStore, getDetailStore };
