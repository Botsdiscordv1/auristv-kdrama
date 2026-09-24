/**
 * src/services/RelatedService.js
 * Motor híbrido de contenido relacionado y sagas para AurisTv_movies_series.
 * Ponderación: Sagas (+50pts) + Keywords (40%) + Géneros (35%) + Director/Reparto (15%) + Score (10%).
 */

const { getCatalogStore, normalizeKey } = require('../database/CatalogStore');
const { toCardDTO } = require('../dto/MovieSeriesDTO');

class RelatedService {
  constructor(dbPath) {
    this.catalogStore = getCatalogStore(dbPath);
    this.db = this.catalogStore.db;
  }

  async getRelated({ title, year, tmdbId, mediaType, limit = 12 } = {}) {
    const targetId = this._resolveTargetId({ title, tmdbId, mediaType });
    if (!targetId) return [];

    const targetItem = this.db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(targetId);
    if (!targetItem) return [];

    const targetKeywords = new Set(
      this.db.prepare('SELECT keyword FROM catalog_keywords WHERE catalog_id = ?').all(targetId).map(r => r.keyword)
    );
    const targetGenres = new Set(
      this.db.prepare('SELECT genre FROM catalog_genres WHERE catalog_id = ?').all(targetId).map(r => r.genre)
    );
    const targetCast = new Set(
      this.db.prepare('SELECT name FROM catalog_cast WHERE catalog_id = ?').all(targetId).map(r => r.name)
    );

    const candidates = this.db.prepare(`
      SELECT id, tmdb_id as tmdbId, media_type as mediaType, title, original_title as originalTitle,
             kind, year, status, score, rating, overview, poster, backdrop, logo, collection_id as collectionId,
             available_sources as availableSources
      FROM catalog_items
      WHERE id != ?
      ORDER BY score DESC LIMIT 150
    `).all(targetId);

    const scored = candidates.map(c => {
      let score = 0;

      // 0. Colección/Saga (+50 bonus)
      if (targetItem.collection_id && c.collectionId === targetItem.collection_id) {
        score += 50.0;
      }

      // 1. Keywords Overlap (40%)
      try {
        const cKws = this.db.prepare('SELECT keyword FROM catalog_keywords WHERE catalog_id = ?').all(c.id);
        cKws.forEach(k => {
          if (targetKeywords.has(k.keyword)) score += 4.0;
        });
      } catch {}

      // 2. Genres Overlap (35%)
      try {
        const cGenres = this.db.prepare('SELECT genre FROM catalog_genres WHERE catalog_id = ?').all(c.id);
        cGenres.forEach(g => {
          if (targetGenres.has(g.genre)) score += 3.5;
        });
      } catch {}

      // 3. Cast / Director Overlap (15%)
      try {
        const cCast = this.db.prepare('SELECT name FROM catalog_cast WHERE catalog_id = ?').all(c.id);
        cCast.forEach(person => {
          if (targetCast.has(person.name)) score += 2.5;
        });
      } catch {}

      // 4. Score Match (10%)
      if (c.score != null) {
        score += parseFloat(c.score) * 0.1;
      }

      return { candidate: c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const finalItems = scored.slice(0, limit).map(s => toCardDTO({
      ...s.candidate,
      availableSources: s.candidate.availableSources ? JSON.parse(s.candidate.availableSources) : [],
    }));

    return finalItems;
  }

  _resolveTargetId({ title, tmdbId, mediaType }) {
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
}

module.exports = { RelatedService };
