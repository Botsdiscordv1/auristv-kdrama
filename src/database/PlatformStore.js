/**
 * src/database/PlatformStore.js
 * Tabla `platforms`: registro de plataformas de streaming observadas al abrir
 * un detail, agrupadas por proveedor original (Netflix, Max, Disney+...) con
 * todas sus variantes ("Netflix Standard with Ads", "Disney+ Basic with Ads"...).
 *
 * Cada fila conserva datos valiosos del título (year, ranking, genres, sources,
 * países, monetización) para futuras secciones editoriales:
 *   - TOP 10 de Netflix
 *   - Películas de Netflix
 *   - Mejor rankeadas de Crunchyroll, etc.
 *
 * El upsert ocurre en CADA apertura de detail (aunque venga de caché) y
 * acumula `view_count` + `last_seen_at`.
 */

const { LocalDatabase } = require('./LocalDatabase');

const REGIONS = ['US', 'MX', 'ES', 'AR', 'CO', 'CL'];
const MONETIZATIONS = ['flatrate', 'ads', 'free', 'rent', 'buy'];

// [nombre canónico, ...claves normalizadas que mapean a él]
const PLATFORM_KEYS = [
  ['Netflix', 'netflix'],
  ['Max', 'hbo max', 'hbo go', 'max'],
  ['Disney+', 'disney plus'],
  ['Amazon Prime Video', 'amazon prime video', 'prime video'],
  ['Apple TV+', 'apple tv plus'],
  ['Apple TV', 'apple tv'],
  ['Paramount+', 'paramount plus', 'cbs all access'],
  ['Hulu', 'hulu'],
  ['Crunchyroll', 'crunchyroll'],
  ['Funimation', 'funimation'],
  ['HIDIVE', 'hidive'],
  ['Star+', 'star plus'],
  ['Peacock', 'peacock'],
  ['Tubi', 'tubi'],
  ['Pluto TV', 'pluto tv'],
  ['MUBI', 'mubi'],
  ['VIX', 'vix'],
  ['Claro Video', 'claro video'],
  ['Lionsgate+', 'lionsgate plus'],
];

// Matchers ordenados por longitud de clave desc: "amazon prime video" gana
// sobre "prime video", "apple tv plus" sobre "apple tv", etc.
const PLATFORM_MATCHERS = [];
for (const [canonical, ...keys] of PLATFORM_KEYS) {
  for (const k of keys) PLATFORM_MATCHERS.push({ canonical, key: k });
}
PLATFORM_MATCHERS.sort((a, b) => b.key.length - a.key.length);

/** Normaliza un nombre a clave de comparación: "Disney+" → "disney plus". */
function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve el proveedor original de un provider name, incluyendo variantes:
 *   "Netflix Standard with Ads" → "Netflix"
 *   "HBO Max"                   → "Max"
 *   "Prime Video"               → "Amazon Prime Video"
 * Si no matchea con ningún conocido, devuelve el nombre tal cual (ya es raíz).
 */
function canonicalPlatform(name) {
  const key = normalizeKey(name);
  if (!key) return String(name || '').trim();
  for (const m of PLATFORM_MATCHERS) {
    if (key === m.key || key.startsWith(m.key + ' ')) return m.canonical;
  }
  // Fallback: quita tokens de variante comunes y reintenta.
  const stripped = key
    .replace(/\b(con anuncios|con publicidad|with ads|standard|basic|premium|gratuito|free|mobile|movil|full|ultra)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped && stripped !== key) {
    for (const m of PLATFORM_MATCHERS) {
      if (stripped === m.key || stripped.startsWith(m.key + ' ')) return m.canonical;
    }
  }
  return String(name).trim();
}

/**
 * Agrupa los watch/providers de TMDB por proveedor original.
 * Además de [{providerName, logo}] (shape legacy), cada entrada lleva:
 *   - variants:      nombres crudos de variantes ("Netflix Standard with Ads")
 *   - countries:     regiones donde se observó
 *   - monetizations: flatrate/ads/free/rent/buy observados
 *
 * @param {object} results detail['watch/providers'].results (o equivalente)
 * @param {string[]} regions orden de prioridad
 */
function groupWatchProviders(results, regions = REGIONS) {
  const out = [];
  if (!results || typeof results !== 'object') return out;
  const byPlatform = new Map();

  for (const region of regions) {
    const pd = results[region];
    if (!pd) continue;
    for (const mono of MONETIZATIONS) {
      for (const p of (Array.isArray(pd[mono]) ? pd[mono] : [])) {
        if (!p || !p.provider_name) continue;
        const platform = canonicalPlatform(p.provider_name);
        const logo = p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null;
        const isVariant = normalizeKey(p.provider_name) !== normalizeKey(platform);

        let g = byPlatform.get(platform);
        if (!g) {
          g = { providerName: platform, logo: null, logoBase: null, variants: [], countries: [], monetizations: [] };
          byPlatform.set(platform, g);
        }
        // Preferir el logo del proveedor base sobre el de la variante.
        if (isVariant) {
          if (!g.logo && logo) g.logo = logo;
        } else {
          if (!g.logoBase && logo) g.logoBase = logo;
          if (!g.logo && logo) g.logo = logo;
        }
        if (isVariant && !g.variants.includes(p.provider_name)) g.variants.push(p.provider_name);
        if (!g.countries.includes(region)) g.countries.push(region);
        if (!g.monetizations.includes(mono)) g.monetizations.push(mono);
      }
    }
  }

  for (const g of byPlatform.values()) {
    out.push({
      providerName: g.providerName,
      logo: g.logoBase || g.logo,
      variants: g.variants,
      countries: g.countries,
      monetizations: g.monetizations,
    });
  }
  return out;
}

/**
 * Re-agrupa entradas de platforms ya serializadas (DTO en caché puede tener el
 * shape plano legado [{providerName, logo}]) al modelo agrupado.
 */
function mergePlatformEntries(entries) {
  const out = [];
  if (!Array.isArray(entries)) return out;
  const byPlatform = new Map();
  for (const e of entries) {
    if (!e) continue;
    const raw = e.providerName || e.name || e.platform || '';
    if (!raw) continue;
    const platform = canonicalPlatform(raw);
    const isVariant = normalizeKey(raw) !== normalizeKey(platform);
    let g = byPlatform.get(platform);
    if (!g) {
      g = { providerName: platform, logo: null, variants: [], countries: [], monetizations: [] };
      byPlatform.set(platform, g);
      out.push(g);
    }
    if (!g.logo && e.logo) g.logo = e.logo;
    const variants = Array.isArray(e.variants) ? e.variants : [];
    const extraVariant = isVariant ? [raw] : [];
    for (const v of [...variants, ...extraVariant]) {
      if (v && normalizeKey(v) !== normalizeKey(platform) && !g.variants.includes(v)) g.variants.push(v);
    }
    for (const c of (Array.isArray(e.countries) ? e.countries : [])) {
      if (!g.countries.includes(c)) g.countries.push(c);
    }
    for (const m of (Array.isArray(e.monetizations) ? e.monetizations : [])) {
      if (!g.monetizations.includes(m)) g.monetizations.push(m);
    }
  }
  return out;
}

/** Acepta ["GnulaHD"] o [{source:"GnulaHD", url}] → ["GnulaHD"] */
function extractSourceNames(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const s of arr) {
    if (!s) continue;
    if (typeof s === 'string') {
      if (!out.includes(s)) out.push(s);
    } else if (typeof s === 'object') {
      const name = s.source || s.name;
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function toNameList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const g of value) {
    const n = typeof g === 'string' ? g : (g && (g.name || g.title));
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

const SORTS = {
  views: 'view_count DESC, title ASC',
  rating: 'ranking DESC, title ASC',
  recent: 'last_seen_at DESC',
  year: 'year DESC, title ASC',
  title: 'title ASC',
};

class PlatformStore {
  constructor(dbPath) {
    this.localDb = LocalDatabase.getDatabase(dbPath);
    this.db = this.localDb.db;
    this._ensureSchema();
  }

  _ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS platforms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,            -- proveedor original canónico ("Netflix")
        variants TEXT NOT NULL DEFAULT '[]',-- variantes JSON (["Netflix Standard with Ads"])
        logo TEXT,
        media_type TEXT NOT NULL DEFAULT 'movie',
        tmdb_id INTEGER NOT NULL DEFAULT 0, -- 0 = desconocido
        title TEXT NOT NULL,
        title_key TEXT NOT NULL,           -- título normalizado (dedup case/acento-insensible)
        year INTEGER,
        ranking REAL,
        genres TEXT NOT NULL DEFAULT '[]',  -- JSON ["Acción","Drama"]
        sources TEXT NOT NULL DEFAULT '[]', -- JSON fuentes Auris ["GnulaHD"]
        countries TEXT NOT NULL DEFAULT '[]',-- JSON regiones ["US","MX"]
        monetization TEXT NOT NULL DEFAULT '[]',-- JSON ["flatrate","ads"]
        certification TEXT,
        poster TEXT,
        view_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_platforms_key
        ON platforms(platform, media_type, tmdb_id, title_key);
      CREATE INDEX IF NOT EXISTS idx_platforms_platform ON platforms(platform);
      CREATE INDEX IF NOT EXISTS idx_platforms_ranking ON platforms(ranking);
      CREATE INDEX IF NOT EXISTS idx_platforms_views ON platforms(view_count);
      CREATE INDEX IF NOT EXISTS idx_platforms_year ON platforms(year);
    `);
  }

  /**
   * Registra/actualiza las plataformas de un detail abierto.
   * Nunca lanza: el detalle siempre debe responder aunque falle SQLite.
   * @returns {number} filas afectadas (0 si no hay plataformas/título)
   */
  recordDetailPlatforms(detail, opts = {}) {
    if (!detail || typeof detail !== 'object') return 0;
    // Primer array no vacío: opts → top-level → anime.
    const raw = [opts.platforms, detail.platforms, detail.anime && detail.anime.platforms]
      .find((a) => Array.isArray(a) && a.length > 0) || [];
    const grouped = mergePlatformEntries(raw);
    const title = opts.title || detail.title || (detail.anime && detail.anime.title) || '';
    if (grouped.length === 0 || !title) return 0;

    const animeObj = detail.anime || {};
    const mediaType = opts.mediaType || detail.mediaType || (detail.isMovie || detail.type === 'MOVIE' ? 'movie' : 'tv');
    const tmdbId = parseInt(opts.tmdbId ?? detail.tmdbId ?? (typeof detail.id === 'number' ? detail.id : 0), 10) || 0;
    const year = parseInt(detail.year, 10)
      || (detail.releaseDate ? parseInt(String(detail.releaseDate).slice(0, 4), 10) : null)
      || parseInt(animeObj.year, 10)
      || null;
    const rawRanking = opts.ranking ?? detail.score ?? detail.rating ?? animeObj.score ?? animeObj.rating ?? null;
    const ranking = rawRanking == null || rawRanking === '' ? null : Number(rawRanking);
    const genres = toNameList(
      Array.isArray(detail.genres) && detail.genres.length ? detail.genres
        : (opts.genres || animeObj.genres || [])
    );
    const sources = extractSourceNames(opts.sources || detail.sources || detail.availableSources || opts.source || null);
    const certification = detail.certification || animeObj.certification || null;
    const poster = detail.poster || animeObj.poster || null;
    const titleKey = normalizeKey(title);
    const now = Date.now();
    if (!titleKey) return 0;

    const stmt = this.db.prepare(`
      INSERT INTO platforms
        (platform, variants, logo, media_type, tmdb_id, title, title_key, year, ranking,
         genres, sources, countries, monetization, certification, poster,
         view_count, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(platform, media_type, tmdb_id, title_key) DO UPDATE SET
        logo = COALESCE(excluded.logo, platforms.logo),
        year = COALESCE(excluded.year, platforms.year),
        ranking = COALESCE(excluded.ranking, platforms.ranking),
        genres = CASE WHEN excluded.genres <> '[]' THEN excluded.genres ELSE platforms.genres END,
        sources = CASE WHEN excluded.sources <> '[]' THEN excluded.sources ELSE platforms.sources END,
        countries = CASE WHEN excluded.countries <> '[]' THEN excluded.countries ELSE platforms.countries END,
        monetization = CASE WHEN excluded.monetization <> '[]' THEN excluded.monetization ELSE platforms.monetization END,
        variants = CASE WHEN excluded.variants <> '[]' THEN excluded.variants ELSE platforms.variants END,
        certification = COALESCE(excluded.certification, platforms.certification),
        poster = COALESCE(excluded.poster, platforms.poster),
        view_count = platforms.view_count + 1,
        last_seen_at = excluded.last_seen_at
    `);

    let touched = 0;
    for (const g of grouped) {
      stmt.run(
        g.providerName,
        JSON.stringify(g.variants || []),
        g.logo || null,
        mediaType,
        tmdbId,
        title,
        titleKey,
        year,
        Number.isFinite(ranking) ? ranking : null,
        JSON.stringify(genres),
        JSON.stringify(sources),
        JSON.stringify(g.countries || []),
        JSON.stringify(g.monetizations || []),
        certification,
        poster,
        now,
        now
      );
      touched += 1;
    }
    return touched;
  }

  /**
   * Listado paginado de la tabla con filtros.
   * @param {{platform?:string, mediaType?:string, search?:string, year?:number|string,
   *          genre?:string, sort?:string, limit?:number|string, offset?:number|string}} q
   */
  list(q = {}) {
    const where = [];
    const params = [];
    if (q.platform) { where.push('LOWER(platform) = LOWER(?)'); params.push(String(q.platform).trim()); }
    if (q.mediaType) { where.push('media_type = ?'); params.push(String(q.mediaType).trim()); }
    if (q.search) { where.push('LOWER(title) LIKE ?'); params.push(`%${String(q.search).toLowerCase()}%`); }
    if (q.year) { where.push('year = ?'); params.push(parseInt(q.year, 10)); }
    if (q.genre) { where.push('genres LIKE ?'); params.push(`%${String(q.genre)}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const order = SORTS[q.sort] || SORTS.views;

    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM platforms ${whereSql}`).get(...params);
    const rows = this.db.prepare(
      `SELECT * FROM platforms ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const items = rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      variants: parseJson(r.variants, []),
      logo: r.logo,
      mediaType: r.media_type,
      tmdbId: r.tmdb_id || null,
      title: r.title,
      year: r.year,
      ranking: r.ranking,
      genres: parseJson(r.genres, []),
      sources: parseJson(r.sources, []),
      countries: parseJson(r.countries, []),
      monetization: parseJson(r.monetization, []),
      certification: r.certification,
      poster: r.poster,
      viewCount: r.view_count,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }));

    return { total: (totalRow && totalRow.total) || 0, limit, offset, sort: q.sort || 'views', items };
  }

  /** Resumen agregado por plataforma: títulos, views, rating promedio, variantes. */
  groupByPlatform() {
    const rows = this.db.prepare(`
      SELECT platform, COUNT(*) AS titles, SUM(view_count) AS views,
             AVG(ranking) AS avgRanking, MAX(last_seen_at) AS lastSeen
      FROM platforms
      GROUP BY platform
      ORDER BY views DESC, titles DESC
    `).all();

    const extras = this.db.prepare('SELECT platform, variants, logo FROM platforms').all();
    const meta = new Map();
    for (const r of extras) {
      let m = meta.get(r.platform);
      if (!m) { m = { logo: null, variants: [] }; meta.set(r.platform, m); }
      if (!m.logo && r.logo) m.logo = r.logo;
      for (const v of parseJson(r.variants, [])) {
        if (v && !m.variants.includes(v)) m.variants.push(v);
      }
    }

    return rows.map((r) => {
      const m = meta.get(r.platform) || { logo: null, variants: [] };
      return {
        platform: r.platform,
        logo: m.logo,
        variants: m.variants,
        titles: r.titles,
        views: r.views || 0,
        avgRanking: r.avgRanking != null ? Math.round(r.avgRanking * 100) / 100 : null,
        lastSeen: r.lastSeen,
      };
    });
  }
}

let _store = null;
function getPlatformStore(dbPath) {
  if (!_store) _store = new PlatformStore(dbPath);
  return _store;
}

module.exports = {
  PlatformStore,
  getPlatformStore,
  canonicalPlatform,
  groupWatchProviders,
  mergePlatformEntries,
  normalizeKey,
};
