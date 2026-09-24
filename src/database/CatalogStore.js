/**
 * src/database/CatalogStore.js
 * Almacén del catálogo SQLite para Películas y Series (AurisTv_movies_series).
 */

const { LocalDatabase } = require('./LocalDatabase');

function normalizeKey(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class CatalogStore {
  constructor(dbPath) {
    this.localDb = LocalDatabase.getDatabase(dbPath);
    this.db = this.localDb.db;
  }

  normalizeKey(str) {
    return normalizeKey(str);
  }

  /** Upsert de ítem de catálogo con metadatos completos. */
  upsertCatalogItem(item = {}) {
    if (!item.title && !item.tmdbId) return null;

    const tmdbId = item.tmdbId ? parseInt(item.tmdbId, 10) : null;
    const mediaType = item.mediaType || (item.kind === 'movie' ? 'movie' : 'tv');
    const kind = item.kind || (mediaType === 'movie' ? 'movie' : 'series');
    const title = item.title || item.originalTitle || '';
    const originalTitle = item.originalTitle || null;
    const year = item.year ? parseInt(item.year, 10) : null;
    const status = item.status || null;
    const certification = item.certification || null;
    const rating = item.rating || item.certification || null;
    const score = item.score != null ? parseFloat(item.score) : null;
    const voteCount = item.voteCount != null ? parseInt(item.voteCount, 10) : 0;
    const runtime = item.runtime ? parseInt(item.runtime, 10) : null;
    const episodeRuntime = item.episodeRuntime ? parseInt(item.episodeRuntime, 10) : null;
    const totalSeasons = item.totalSeasons ? parseInt(item.totalSeasons, 10) : null;
    const totalEpisodes = item.totalEpisodes ? parseInt(item.totalEpisodes, 10) : null;
    const lastAirDate = item.lastAirDate || item.last_air_date || null;
    const overview = item.overview || item.description || null;
    const poster = item.poster || null;
    const backdrop = item.backdrop || null;
    const logo = item.logo || null;
    const banner = item.banner || backdrop || null;
    const collectionId = item.collection?.id ? parseInt(item.collection.id, 10) : (item.collectionId ? parseInt(item.collectionId, 10) : null);
    const collectionName = item.collection?.name || item.collectionName || null;
    // No sobrescribir fuentes existentes con lista vacía (enriquecimientos sin contexto
    // de fuente —p.ej. hidratación TMDB de editorial— borraban available_sources con '[]').
    const availableSources = (Array.isArray(item.availableSources) && item.availableSources.length > 0)
      ? JSON.stringify(item.availableSources)
      : (typeof item.availableSources === 'string' && item.availableSources !== '[]' ? item.availableSources : null);
    const updatedAt = Date.now();

    // 1. Insert or Update catalog_items
    let catalogId = null;
    if (tmdbId && mediaType) {
      const existing = this.db.prepare('SELECT id FROM catalog_items WHERE tmdb_id = ? AND media_type = ?').get(tmdbId, mediaType);
      if (existing) {
        catalogId = existing.id;
        this.db.prepare(`
          UPDATE catalog_items SET
            title = ?, original_title = ?, kind = ?, year = ?, status = ?,
            certification = ?, rating = ?, score = ?, vote_count = ?, runtime = ?,
            episode_runtime = ?, total_seasons = ?, total_episodes = ?, last_air_date = ?, overview = ?,
            poster = COALESCE(?, poster), backdrop = COALESCE(?, backdrop), logo = COALESCE(?, logo),
            banner = COALESCE(?, banner), collection_id = ?, collection_name = ?,
            available_sources = COALESCE(?, available_sources), updated_at = ?
          WHERE id = ?
        `).run(
          title, originalTitle, kind, year, status,
          certification, rating, score, voteCount, runtime,
          episodeRuntime, totalSeasons, totalEpisodes, lastAirDate, overview,
          poster, backdrop, logo, banner, collectionId, collectionName,
          availableSources, updatedAt, catalogId
        );
      }
    }

    if (!catalogId) {
      const res = this.db.prepare(`
        INSERT INTO catalog_items (
          tmdb_id, media_type, title, original_title, kind, type, year, status,
          certification, rating, score, vote_count, runtime, episode_runtime,
          total_seasons, total_episodes, last_air_date, overview, poster, backdrop, logo, banner,
          collection_id, collection_name, available_sources, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tmdbId, mediaType, title, originalTitle, kind, mediaType === 'movie' ? 'MOVIE' : 'TV', year, status,
        certification, rating, score, voteCount, runtime, episodeRuntime,
        totalSeasons, totalEpisodes, lastAirDate, overview, poster, backdrop, logo, banner,
        collectionId, collectionName, availableSources, updatedAt
      );
      catalogId = Number(res.lastInsertRowid);
    }

    // 2. Guardar Variantes de Títulos (título principal, original, en inglés)
    this._saveTitles(catalogId, title, originalTitle, item.titleEnglish);

    // 3. Guardar Imágenes en Galería
    this._saveImages(catalogId, { poster, backdrop, logo, banner });

    // 4. Guardar Géneros
    if (Array.isArray(item.genres) && item.genres.length > 0) {
      this._saveGenres(catalogId, item.genres);
    }

    // 5. Guardar Keywords
    if (Array.isArray(item.keywords) && item.keywords.length > 0) {
      this._saveKeywords(catalogId, item.keywords);
    }

    // 6. Guardar Reparto y Creadores/Directores
    if (Array.isArray(item.cast) || Array.isArray(item.directors)) {
      this._saveCast(catalogId, item.cast, item.directors);
    }

    // 7. Guardar Plataformas
    if (Array.isArray(item.platforms) && item.platforms.length > 0) {
      this._savePlatforms(catalogId, item.platforms);
    }

    return catalogId;
  }

  _saveTitles(catalogId, title, originalTitle, titleEnglish) {
    const seen = new Set();
    const addTitle = (t, isCanonical, lang) => {
      if (!t || typeof t !== 'string') return;
      const key = normalizeKey(t);
      if (!key || seen.has(key)) return;
      seen.add(key);
      try {
        this.db.prepare('INSERT INTO catalog_titles (catalog_id, title_variant, title_key, is_canonical, lang) VALUES (?, ?, ?, ?, ?)')
          .run(catalogId, t.trim(), key, isCanonical ? 1 : 0, lang);
      } catch {}
    };

    addTitle(title, true, 'es');
    if (originalTitle) addTitle(originalTitle, false, 'original');
    if (titleEnglish) addTitle(titleEnglish, false, 'en');
  }

  _saveImages(catalogId, { poster, backdrop, logo, banner }) {
    const saveImg = (url, tipo) => {
      if (!url || typeof url !== 'string') return;
      try {
        const existing = this.db.prepare('SELECT id FROM catalog_images WHERE catalog_id = ? AND tipo = ? AND url = ?').get(catalogId, tipo, url);
        if (!existing) {
          this.db.prepare('INSERT INTO catalog_images (catalog_id, tipo, url, source) VALUES (?, ?, ?, "tmdb")').run(catalogId, tipo, url);
        }
      } catch {}
    };
    saveImg(poster, 'poster');
    saveImg(backdrop, 'backdrop');
    saveImg(logo, 'logo');
    saveImg(banner, 'banner');
  }

  _saveGenres(catalogId, genres) {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO catalog_genres (catalog_id, genre) VALUES (?, ?)');
    for (const g of genres) {
      if (g && typeof g === 'string') {
        stmt.run(catalogId, g.trim());
      }
    }
  }

  _saveKeywords(catalogId, keywords) {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO catalog_keywords (catalog_id, keyword) VALUES (?, ?)');
    for (const k of keywords) {
      if (k && typeof k === 'string') {
        stmt.run(catalogId, k.trim().toLowerCase());
      }
    }
  }

  _saveCast(catalogId, cast = [], directors = []) {
    this.db.prepare('DELETE FROM catalog_cast WHERE catalog_id = ?').run(catalogId);
    const stmt = this.db.prepare('INSERT INTO catalog_cast (catalog_id, name, character, profile, role) VALUES (?, ?, ?, ?, ?)');
    
    for (const d of (directors || [])) {
      if (d) stmt.run(catalogId, typeof d === 'string' ? d : d.name, null, null, 'director');
    }
    for (const c of (cast || []).slice(0, 10)) {
      if (c && c.name) {
        stmt.run(catalogId, c.name, c.character || null, c.profile || null, 'cast');
      }
    }
  }

  _savePlatforms(catalogId, platforms) {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO catalog_platforms (catalog_id, provider_name, logo) VALUES (?, ?, ?)');
    for (const p of platforms) {
      if (p && (p.providerName || p.name)) {
        stmt.run(catalogId, p.providerName || p.name, p.logo || null);
      }
    }
  }

  /** Búsqueda instantánea en catálogo por variantes de título (< 5ms). */
  searchCatalog(query, { limit = 20, kind = null } = {}) {
    const key = normalizeKey(query);
    if (!key || key.length < 2) return [];

    const params = [`%${key}%`];
    if (kind) {
      params.push(kind);
    }
    params.push(parseInt(limit, 10));

    try {
      const rows = this.db.prepare(`
        SELECT DISTINCT c.id, c.tmdb_id as tmdbId, c.media_type as mediaType, c.title, c.original_title as originalTitle,
               c.kind, c.year, c.status, c.score, c.rating, c.overview, c.poster, c.backdrop, c.logo,
               c.available_sources as availableSources
        FROM catalog_titles t
        JOIN catalog_items c ON c.id = t.catalog_id
        WHERE t.title_key LIKE ?
        ${kind ? 'AND c.kind = ?' : ''}
        ORDER BY c.score DESC LIMIT ?
      `).all(...params);

      return rows.map(r => ({
        ...r,
        availableSources: r.availableSources ? JSON.parse(r.availableSources) : [],
      }));
    } catch {
      return [];
    }
  }

  /** Obtiene elementos pertenecientes a la misma saga/colección. */
  getCollectionItems(collectionId) {
    if (!collectionId) return [];
    try {
      const rows = this.db.prepare(`
        SELECT id, tmdb_id as tmdbId, media_type as mediaType, title, year, poster, score
        FROM catalog_items
        WHERE collection_id = ?
        ORDER BY year ASC
      `).all(collectionId);
      return rows;
    } catch {
      return [];
    }
  }


  /** Guardar traducción permanente de episodio desde el frontend. */
  saveEpisodeTranslation({ catalogId, season = 1, episodeNumber, titleEs, overviewEs, stillPath }) {
    if (!catalogId || !episodeNumber) return false;
    const seasonVal = parseInt(season, 10) || 1;
    const epNum = parseInt(episodeNumber, 10);
    const now = Date.now();

    try {
      this.db.prepare(`
        INSERT INTO catalog_episodes (catalog_id, season, episode_number, title_es, overview_es, still_path, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(catalog_id, season, episode_number) DO UPDATE SET
          title_es = COALESCE(excluded.title_es, title_es),
          overview_es = COALESCE(excluded.overview_es, overview_es),
          still_path = COALESCE(excluded.still_path, still_path),
          updated_at = excluded.updated_at
      `).run(catalogId, seasonVal, epNum, titleEs || null, overviewEs || null, stillPath || null, now);
      return true;
    } catch (err) {
      console.error('[CatalogStore] Error saving episode translation:', err.message);
      return false;
    }
  }

  /** Obtener traducciones guardadas de episodios para una temporada. */
  getEpisodeTranslations(catalogId, season = 1) {
    if (!catalogId) return new Map();
    const seasonVal = parseInt(season, 10) || 1;
    try {
      const rows = this.db.prepare(`
        SELECT episode_number as episodeNumber, title_es as titleEs, overview_es as overviewEs, still_path as stillPath
        FROM catalog_episodes
        WHERE catalog_id = ? AND season = ?
      `).all(catalogId, seasonVal);
      const map = new Map();
      rows.forEach(r => map.set(r.episodeNumber, r));
      return map;
    } catch {
      return new Map();
    }
  }

  getImage(titleKey, tipo = 'poster') {
    try {
      const row = this.db.prepare(`
        SELECT i.url
        FROM catalog_titles t
        JOIN catalog_images i ON i.catalog_id = t.catalog_id
        WHERE t.title_key = ? AND i.tipo = ?
        LIMIT 1
      `).get(titleKey, tipo);
      return row ? row.url : null;
    } catch {
      return null;
    }
  }
}

let storeInstance = null;
function getCatalogStore(dbPath) {
  if (!storeInstance) {
    storeInstance = new CatalogStore(dbPath);
  }
  return storeInstance;
}

module.exports = { CatalogStore, getCatalogStore, normalizeKey };
