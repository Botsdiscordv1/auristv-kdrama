/**
 * src/database/LocalDatabase.js
 * Base de datos SQLite ligera para el servidor de Películas y Series (AurisTv_movies_series).
 * Utiliza node:sqlite (Node 22+) con modo WAL para alto rendimiento y cero dependencias nativas.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let instance = null;

class LocalDatabase {
  constructor(dbPath) {
    const finalPath = dbPath || path.join(__dirname, '..', '..', 'data', 'movies_series.db');
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(finalPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    this._initTables();
  }

  _initTables() {
    // 1. Entidad principal de catálogo (Películas y Series)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdb_id INTEGER,
        media_type TEXT CHECK(media_type IN ('movie', 'tv')),
        title TEXT NOT NULL,
        original_title TEXT,
        kind TEXT CHECK(kind IN ('movie', 'series')),
        type TEXT,
        year INTEGER,
        status TEXT,
        certification TEXT,
        rating TEXT,
        score REAL,
        vote_count INTEGER,
        runtime INTEGER,
        episode_runtime INTEGER,
        total_seasons INTEGER,
        total_episodes INTEGER,
        last_air_date TEXT,
        overview TEXT,
        poster TEXT,
        backdrop TEXT,
        logo TEXT,
        banner TEXT,
        collection_id INTEGER,
        collection_name TEXT,
        available_sources TEXT, -- JSON Array: ["OnlyPelis", "GnulaHD"]
        updated_at INTEGER,
        UNIQUE(tmdb_id, media_type)
      );
    `);

    // Auto-migración de columnas en bases de datos preexistentes
    try {
      this.db.exec("ALTER TABLE catalog_items ADD COLUMN last_air_date TEXT;");
    } catch {}

    // 2. Variantes de título para búsqueda difusa instantánea
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER NOT NULL,
        title_variant TEXT NOT NULL,
        title_key TEXT NOT NULL,
        is_canonical INTEGER DEFAULT 0,
        lang TEXT,
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_titles_key ON catalog_titles(title_key);
      CREATE INDEX IF NOT EXISTS idx_titles_catalog ON catalog_titles(catalog_id);
    `);

    // 3. Galería de imágenes en alta resolución
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER NOT NULL,
        tipo TEXT CHECK(tipo IN ('poster', 'backdrop', 'logo', 'banner', 'thumbnail')),
        url TEXT NOT NULL,
        source TEXT DEFAULT 'tmdb',
        width INTEGER,
        height INTEGER,
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_images_catalog_tipo ON catalog_images(catalog_id, tipo);
    `);

    // 4. Géneros oficiales TMDB
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_genres (
        catalog_id INTEGER NOT NULL,
        genre TEXT NOT NULL,
        PRIMARY KEY (catalog_id, genre),
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_genres_name ON catalog_genres(genre);
    `);

    // 5. Keywords/Tags de TMDB
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_keywords (
        catalog_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        PRIMARY KEY (catalog_id, keyword),
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_keywords_name ON catalog_keywords(keyword);
    `);

    // 6. Creadores, Directores y Reparto
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_cast (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        character TEXT,
        profile TEXT,
        role TEXT CHECK(role IN ('director', 'creator', 'cast')),
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_cast_catalog ON catalog_cast(catalog_id);
      CREATE INDEX IF NOT EXISTS idx_cast_name ON catalog_cast(name);
    `);

    // 7. Plataformas de Streaming (Watch Providers)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_platforms (
        catalog_id INTEGER NOT NULL,
        provider_name TEXT NOT NULL,
        logo TEXT,
        PRIMARY KEY (catalog_id, provider_name),
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
    `);

    // 8. DTO de Detalle Completo en JSON (Caché Persistente L1/L2)
    
    // 9. Traducciones permanentes de episodios enviadas por el frontend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_episodes (
        catalog_id INTEGER NOT NULL,
        season INTEGER NOT NULL DEFAULT 1,
        episode_number INTEGER NOT NULL,
        title_es TEXT,
        overview_es TEXT,
        still_path TEXT,
        updated_at INTEGER,
        PRIMARY KEY (catalog_id, season, episode_number),
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_episodes_catalog_season ON catalog_episodes(catalog_id, season);
    `);

    // Traducciones comunitarias de episodios (mismo flujo que el server anime):
    // overlay gap-fill + flag needsTranslation. Clave (tmdb_id, season, episode, lang).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS community_translations (
        tmdb_id     INTEGER NOT NULL,
        season      INTEGER NOT NULL,
        episode     INTEGER NOT NULL,
        lang        TEXT NOT NULL,
        title       TEXT,
        overview    TEXT,
        updated_at  INTEGER,
        PRIMARY KEY (tmdb_id, season, episode, lang)
      );
      CREATE TABLE IF NOT EXISTS community_translation_quota (
        who   TEXT NOT NULL,
        day   TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (who, day)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS item_detail (
        catalog_id INTEGER NOT NULL,
        season INTEGER DEFAULT 1,
        data TEXT NOT NULL, -- JSON DTO completo
        args TEXT,
        refreshed_at INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        backdrop_path TEXT,
        PRIMARY KEY (catalog_id, season),
        FOREIGN KEY (catalog_id) REFERENCES catalog_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_detail_catalog ON item_detail(catalog_id);
    `);
  }

  static getInstance(dbPath) {
    if (!instance) {
      instance = new LocalDatabase(dbPath);
    }
    return instance;
  }

  static getDatabase(dbPath) {
    return LocalDatabase.getInstance(dbPath);
  }

  /** Claves de community translations para un (tmdb, season). */
  communityKeys(tmdbId, season) {
    if (!tmdbId) return [];
    try {
      const rows = this.db.prepare(
        'SELECT episode, lang, title, overview FROM community_translations WHERE tmdb_id = ? AND season = ?'
      ).all(parseInt(tmdbId, 10), parseInt(season, 10) || 1);
      return rows;
    } catch {
      return [];
    }
  }

  communitySave({ tmdbId, season, episode, lang, title, overview }) {
    try {
      this.db.prepare(`
        INSERT INTO community_translations (tmdb_id, season, episode, lang, title, overview, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tmdb_id, season, episode, lang) DO UPDATE SET
          title = COALESCE(excluded.title, title),
          overview = COALESCE(excluded.overview, overview),
          updated_at = excluded.updated_at
      `).run(
        parseInt(tmdbId, 10), parseInt(season, 10) || 1, parseInt(episode, 10),
        lang, title || null, overview || null, Date.now()
      );
      return true;
    } catch {
      return false;
    }
  }

  communityQuotaGet(who, day) {
    try {
      const row = this.db.prepare(
        'SELECT count FROM community_translation_quota WHERE who = ? AND day = ?'
      ).get(who, day);
      return row ? (row.count | 0) : 0;
    } catch {
      return 0;
    }
  }

  communityQuotaSet(who, day, count) {
    try {
      this.db.prepare(`
        INSERT INTO community_translation_quota (who, day, count) VALUES (?, ?, ?)
        ON CONFLICT(who, day) DO UPDATE SET count = excluded.count
      `).run(who, day, count | 0);
    } catch {}
  }
}

module.exports = { LocalDatabase };
