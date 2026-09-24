require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const { PORT, getTMDBKey, TMDB_API_KEY, OMDB_API_KEY } = require("./utils/config");
const SOURCES = require("./sources.js");
const {
  normalizeStr, cleanTitle, toSlugBasic, extractSlug, normalizeSlug,
  parseAnimeContinuation, extractFranchiseRoot, translateSeason,
  normalizeAnimeFormats, dedupeByUrl,
  isPromotionalEntry, isReleasedAnime, buildFranchiseMap,
  normalizeLanguageQuality,
} = require("./utils/helpers");
const { fetchMovieSeriesDetail } = require("./services/anime-detail");
const { extract: extractVideo } = require("./services/extractors");
const { getEpisodes, clearCache: clearEpisodesCache } = require("./services/episodes");
const notifications = require("./services/notifications");
const { getEpisodeSynopsis, getSeasonEpisodes, getCacheStats: getOmdbCacheStats } = require("./services/omdb");
const { mergeSearchResults, normalizeText } = require("./utils/search-merge");
const { MovieDetailService, EpisodeService, ExtractService } = require("./src/services");
const { send, sendError } = require("./src/http/ResponseWrapper");

const movieDetailService = new MovieDetailService();
const episodeService = new EpisodeService();
const extractService = new ExtractService();

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.locals.startTime = Date.now();
  next();
});

const searchCache = new Map();
const extractCache = new Map();
const metaCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// Limpiar cache al iniciar para aplicar nuevas mejoras de portadas
searchCache.clear();

function cleanTitleForEnrichment(title) {
  return title
    .replace(/\[slugs:[^\]]+\]/g, "")
    .replace(/\((TV|Pelicula|Movie|OVA|ONA|Especial|En emisión|Finalizado)\)/gi, "")
    .replace(/\b(Sub Español|Latino|Castellano|Dual|BD|HD|1080p|720p|4K|x265|HEVC)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSeasonSuffix(title) {
  const t = cleanTitleForEnrichment(title);
  return t
    .replace(/\s*(?:[-:–—]?\s*)?(?:\d+(?:st|nd|rd|th)?\s*(?:season|temporada|part|parte|cour)|(?:season|temporada|part|parte|cour)\s*\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/i, "")
    .trim() || t;
}

function expandConcatenatedTitle(str) {
  return (str || "").replace(/([a-zA-Z]{2,4})\1{2,}([a-zA-Z]+)/gi, (match, p1, p2) => {
    const n = (match.length - p2.length) / p1.length;
    const words = [];
    for (let i = 0; i < n - 1; i++) words.push(p1);
    words.push(p1 + p2);
    return words.join(" ");
  });
}

function joinRepeatedWords(str) {
  return (str || "").replace(/\b(\w{2,4})\b(?:\s+\1\b)+(?:\s+(\w+))?/gi, (match, w, rest) => {
    const words = match.split(/\s+/);
    const n = words.filter(x => x.toLowerCase() === w.toLowerCase()).length;
    const tail = words.slice(n).join('').toLowerCase();
    const joined = w.toLowerCase().repeat(n - 1) + w.toLowerCase() + tail;
    return w[0].toUpperCase() + joined.slice(1);
  });
}


function slugToTitle(slug) {
  return (slug || "")
    .replace(/(\d+)([a-z]{3,})/gi, '$1-$2')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\s+(?:19|20)\d{2}$/, '')
    .replace(/\b(?:Ii|Iii|Iv|Vi|Vii|Viii|Ix|X)\b/g, m => m.toUpperCase())
    .replace(/\b(\d+)\s+(nin|st|nd|rd|th)\b/gi, '$1-$2');
}

async function searchSource(source, query, options = {}) {
  // Filtro Profesional: Si la query no tiene caracteres latinos, ni siquiera llamamos a la fuente
  if (!/[a-zA-Z0-9]/.test(query)) {
    return [];
  }

  try {
    const results = await source.search(query, axios, cheerio, options);
    console.log(`[${source.name}] "${query}" → ${results.length} resultados`);
    return results.map((r) => ({ ...r, source: source.name }));
  } catch (err) {
    console.error(`[${source.name}] ERROR en "${query}": ${err.message}`);
    return [];
  }
}

const NAV_BLACKLIST = [
  "peliculas", "películas", "estrenos", "series", "anime",
  "genero", "género", "inicio", "home", "accion", "acción",
  "comedia", "terror", "drama", "ver más", "más", "populares",
  "crimen", "romance", "sorprendeme", "sorpréndeme",
  "pelicula", "película", "película de tv", "estrenos de peliculas",
  "estrenos de películas", "estrenos de pelicula", "estrenos de película",
  "nuevas peliculas", "nuevas películas",
];


function deduplicateSearchResults(results, query = "") {
  if (!Array.isArray(results) || results.length <= 1) return results;

  let merged = mergeSearchResults(results);
  if (merged.length <= 1 || !query) return merged;

  // --- Consistent title normalization across franchise entries ---
  const qLower = query.toLowerCase().trim();

  const ROMAN_TO_NUM = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  const ORDINAL_MAP = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th", 7: "7th", 8: "8th", 9: "9th", 10: "10th" };

  function getSeasonInfo(slug = "", title = "") {
    const combined = `${slug} ${title}`.toLowerCase();

    const arcKeywords = ["arc", "hen", "special", "especial", "ova", "oad"];
    if (arcKeywords.some(kw => combined.includes(kw))) {
      return { number: 100, label: "Special" };
    }

    let m = combined.match(/(\d+)(?:st|nd|rd|th)[-\s]*(?:season|temporada|temp|cour|part|parte)/i)
      || combined.match(/(?:season|temporada|temp|cour|part|parte)[-\s]*(\d+)/i)
      || combined.match(/\bs(\d{1,2})(?:[-\s]|$)/i);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num >= 2 && num <= 20) return { number: num, label: `${ORDINAL_MAP[num] || num + 'th'} Season` };
    }

    m = combined.match(/[-\s](ii|iii|iv|v|vi|vii|viii|ix|x)(?:[-\s]|$)/i);
    if (m) {
      const roman = m[1].toLowerCase();
      const num = ROMAN_TO_NUM[roman];
      if (num) return { number: num, label: `${ORDINAL_MAP[num] || num + 'th'} Season` };
    }

    m = slug.match(/[-\s](\d{1,2})$/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num >= 2 && num <= 20) return { number: num, label: `${ORDINAL_MAP[num] || num + 'th'} Season` };
    }

    if (/final[-\s]*season|temporada[-\s]*final|kanketsu/i.test(combined)) {
      return { number: 99, label: "Final Season" };
    }

    return { number: null, label: "" };
  }

  function getBaseSlugKey(slug) {
    const noMergeKeywords = ["recap", "special", "especial", "ova", "oad"];
    const seasonArcKeywords = ["shimetsu", "kaiyuu", "zenpen", "kouhen"];
    const lower = slug.toLowerCase();
    if (noMergeKeywords.some(kw => lower.includes(kw))) {
      return lower;
    }

    const hasArc = seasonArcKeywords.some(kw => lower.includes(kw));

    let base = slug
      .replace(/[-](?:season|temporada|tv)[-]?\d*$/i, "")
      .replace(/[-]\d+(?:st|nd|rd|th)?[-]?(?:season|temporada)?$/i, "")
      .replace(/[-]s\d{1,2}$/i, "")
      .replace(/[-](?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i, "")
      .replace(/[-\s]\d{1,2}$/, "");

    if (hasArc) {
      base = base.replace(new RegExp('[-](' + seasonArcKeywords.join('|') + ')', 'gi'), '');
    }

    return base || lower;
  }

  const franchiseGroups = new Map();
  for (const item of merged) {
    const slug = item.slug || extractSlug(item.url);
    const normSlug = normalizeSlug(slug);
    const baseKey = getBaseSlugKey(normSlug) || normSlug;
    if (!franchiseGroups.has(baseKey)) franchiseGroups.set(baseKey, []);
    franchiseGroups.get(baseKey).push(item);
  }

  for (const [groupKey, groupItems] of franchiseGroups) {
    const baseItem = groupItems.find(r => {
      const s = r.slug || extractSlug(r.url);
      return getSeasonInfo(s, r.title).number === null;
    });
    if (!baseItem) continue;

    const baseSlug = baseItem.slug || extractSlug(baseItem.url);
    const baseNormSlug = normalizeSlug(baseSlug);
    const baseTitleCandidates = [baseItem.title];

    let bestBase = baseItem.title;
    let bestScore = -1;
    for (const candidate of [...new Set(baseTitleCandidates)]) {
      const tWords = candidate.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
      const qWords = qLower.replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
      const common = qWords.filter(w => tWords.includes(w)).length;
      const score = common / Math.max(qWords.length, 1);
      if (score > bestScore) {
        bestScore = score;
        bestBase = candidate;
      } else if (score === bestScore) {
        if (candidate.length < bestBase.length) {
          bestBase = candidate;
        }
      }
    }

    const clean = bestBase
      .replace(/\s*[-:]\s*(?:\d+(?:st|nd|rd|th)\s+)?season\s*\d*\s*$/i, "")
      .replace(/\s*season\s*\d+\s*$/i, "")
      .replace(/\s*\d+(?:st|nd|rd|th)\s+season\s*$/i, "")
      .replace(/\s*(?:II|III|IV|V|VI|VII|VIII|IX|X)\s*$/i, "")
      .replace(/\s*[-:]\s*(?:Shimetsu|Kaiyuu|Zenpen|Kouhen)\s*/gi, " ")
      .replace(/\s+(?:Shimetsu|Kaiyuu|Zenpen|Kouhen)\s*/gi, " ")
      .replace(/\s+[-:]\s*$/, "")
      .trim();

    for (const item of groupItems) {
      const s = item.slug || extractSlug(item.url);
      const sInfo = getSeasonInfo(s, item.title);
      if (sInfo.number !== null) {
        item.title = `${clean} ${sInfo.label}`;
      }
    }
  }

  // Second pass: merge franchise group items into one entry with combined sources
  const titleGrouped = new Map();
  for (const item of merged) {
    const key = `${normalizeText(item.title)}:s${item._season || 'base'}`;
    if (!titleGrouped.has(key)) { titleGrouped.set(key, item); continue; }
    const existing = titleGrouped.get(key);
    const itemSources = item.sources?.length ? item.sources : [{ source: item.source, url: item.url, quality: item.quality || '' }];
    for (const s of itemSources) {
      if (!existing.sources?.some(x => x.source === s.source && x.url === s.url)) {
        if (!existing.sources) existing.sources = [];
        existing.sources.push(s);
        if (!existing.availableSources) existing.availableSources = [];
        if (s.source && !existing.availableSources.includes(s.source)) existing.availableSources.push(s.source);
      }
    }
    if (!existing.thumbnail && item.thumbnail) existing.thumbnail = item.thumbnail;
    if (!existing.banner && item.banner) existing.banner = item.banner;
    if (existing.availableSources?.length) existing.source = existing.availableSources[0];
  }

  return [...titleGrouped.values()];
}


async function getTrendingByCategory(category) {
  if (category !== "kdrama" && category !== "all") return [];
  try {
    if (!getTMDBKey()) return [];
    const { data } = await axios.get("https://api.themoviedb.org/3/trending/tv/week", {
      params: { api_key: getTMDBKey(), language: "es-MX", include_adult: false },
      timeout: 5000,
    });
    return (data?.results || [])
      .filter(r => (r.original_language || "") === "ko")
      .slice(0, 30)
      .map(r => ({
        title: r.name || r.original_name, url: "", slug: "",
        thumbnail: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : "",
        banner: r.backdrop_path ? `https://image.tmdb.org/t/p/original${r.backdrop_path}` : "",
        source: "TMDB", quality: "Serie",
        year: (r.first_air_date || "").split("-")[0] || 0,
        fullDate: r.first_air_date || "",
        score: r.vote_average || null, genres: r.genre_ids || [],
        availableSources: ["TMDB"], sources: [{ source: "TMDB", url: "", quality: "Serie" }],
        originalIndex: 0,
      }));
  } catch (err) {
    console.warn(`[Trending] Error: ${err.message}`);
    return [];
  }
}

async function searchByCategory(query, categoria, options = {}) {
  const cacheKey = `${categoria}:${query.toLowerCase().trim()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.results;

  // Normalizar categoría solicitada
  let targetCat = categoria.toLowerCase();
  if (targetCat === "peliculas") targetCat = "peliculas";
  if (targetCat === "kdrama" || targetCat === "kdramas" || targetCat === "doramas") targetCat = "kdrama";
  if (targetCat === "series") targetCat = "peliculas"; // Las series occidentales suelen estar en fuentes de películas

  const fuentes = SOURCES.filter((s) => {
    if (s.enabled === false) return false;
    if (targetCat === "all") return true;
    return s.categoria === targetCat;
  });

  if (!fuentes.length) return [];

  let searchQueries = [query];
  if (options.year) {
    searchQueries.push(`${query} ${options.year}`);
  }
  const cleanQuery = query
    .replace(/\.\s*\d+\s*:\s*.+$/, '')
    .replace(/\s*\(TV\)\s*$/i, '')
    .replace(/\s*\(Movie\)\s*$/i, '')
    .replace(/\s*\(dub\)\s*$/i, '')
    .replace(/\s*\(sub\)\s*$/i, '')
    .replace(/\s*\(Film\)\s*$/i, '')
    .trim();
  if (cleanQuery !== query && !searchQueries.includes(cleanQuery)) {
    searchQueries.push(cleanQuery);
  }
  const joined = joinRepeatedWords(query);
  if (joined !== query && !searchQueries.some(q => q.toLowerCase() === joined.toLowerCase())) {
    searchQueries.push(joined);
  }

  const resultsNested = await Promise.all(
    searchQueries.flatMap(q => fuentes.map(s => searchSource(s, q, options)))
  );
  let results = resultsNested.flat();

  const finalResults = deduplicateSearchResults(results, query);

  // Filtro por año: si la búsqueda tiene año esperado y el resultado tiene año discrepante, lo descartamos
  const expectedYear = options.year ? parseInt(options.year) : null;
  if (expectedYear) {
    for (let i = finalResults.length - 1; i >= 0; i--) {
      const r = finalResults[i];
      if (r.year) {
        const diff = Math.abs(parseInt(expectedYear) - parseInt(r.year));
        if (diff > 2) {
          finalResults.splice(i, 1);
        }
      }
    }
  }

  // --- Enriquecimiento de Metadatos PRO (Carga de Banners y Posters) ---
  if (finalResults.length > 0) {
    const toEnrich = finalResults.slice(0, 15);

    const enrichItem = async (item) => {
      const isAnime = categoria === "anime" || item.source === "AnimeFLV" || item.source === "JKAnime" || item.source === "AnimeAV1";
      const q = cleanTitleForEnrichment(item.title);
      const bannerQuery = q;
      const cacheKey = `${isAnime ? 'anime' : 'movie'}:${bannerQuery}`;

      if (metaCache.has(cacheKey)) {
        const cached = metaCache.get(cacheKey);
        if (!item.thumbnail && cached?.thumbnail) item.thumbnail = cached.thumbnail;
        if (cached?.banner) item.banner = cached.banner;
        return;
      }

      try {
        let banner = null;

        const fetchTMDB = async () => {
          if (!getTMDBKey()) return null;
          const queries = [bannerQuery];
          const baseQ = bannerQuery.replace(/\s*[-–:]\s*.+$/g, "").trim();
          if (baseQ !== bannerQuery) queries.push(baseQ);
          const franchiseQ = baseQ
            .replace(/\s*\d+(?:st|nd|rd|th)?\s*(season|temporada|part|parte|cour)\s*\d*\s*$/i, "")
            .replace(/\s*(season|temporada|part|parte|cour)\s*\d+\s*$/i, "")
            .trim();
          if (franchiseQ !== baseQ) queries.push(franchiseQ);

          for (const q of queries) {
            try {
              const resp = await axios.get("https://api.themoviedb.org/3/search/multi", {
                params: { api_key: getTMDBKey(), query: q, language: "es-MX", include_adult: false },
                timeout: 3000
              });
              const best = resp.data?.results?.find(r =>
                isAnime ? (r.original_language === "ja" || (r.genre_ids || []).includes(16)) : true
              ) || resp.data?.results?.[0];
              if (best) {
                return {
                  poster: best.poster_path ? `https://image.tmdb.org/t/p/w500${best.poster_path}` : null,
                  banner: best.backdrop_path ? `https://image.tmdb.org/t/p/original${best.backdrop_path}` : null
                };
              }
            } catch {}
          }
          return null;
        };

        if (isAnime) {
          const tmdb = await fetchTMDB();
          banner = tmdb?.banner || null;
          if (!item.thumbnail) item.thumbnail = tmdb?.poster || item.thumbnail;
        } else {
          const tmdb = await fetchTMDB();
          banner = tmdb?.banner;
          if (!item.thumbnail) item.thumbnail = tmdb?.poster || item.thumbnail;
        }

        if (banner) item.banner = banner;
        metaCache.set(cacheKey, { banner, thumbnail: item.thumbnail || null });
      } catch (err) {
        console.warn(`[Meta Enrichment] Error para "${q}": ${err.message}`);
      }
    };

    // Enriquecimiento paralelo con concurrencia limitada (3 simultáneas) para no saturar APIs externas
    const CONCURRENCY = 3;
    for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
      const batch = toEnrich.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(item => enrichItem(item)));
    }

  }

  searchCache.set(cacheKey, { results: finalResults, timestamp: Date.now() });
  return finalResults;
}

app.get("/api/search/:category", async (req, res) => {
  try {
    const { category } = req.params;
    let { q, year } = req.query;

    console.log(`[DEBUG Search] category="${category}" q="${q}" year="${year}"`);

    const validCategories = ["kdrama", "all"];
    if (!validCategories.includes(category)) {
      return sendError(res, 400, `Invalid category. Valid: ${validCategories.join(", ")}`);
    }

    let results;
    if (!q) {
      if (category === "kdrama" || category === "all") {
        const cacheKey = `trending:${category}`;
        const TRENDING_TTL = 60 * 60 * 1000;
        const cached = searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < TRENDING_TTL) {
          results = cached.results;
        } else {
          results = await getTrendingByCategory(category);
          if (results?.length) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
          }
        }
      } else {
        return send(res, { query: q, category, count: 0, results: [] });
      }
    } else {
      results = await searchByCategory(q, category, { year: parseInt(year) || null });
    }

    for (const r of results) {
      if (r.thumbnail) r.thumbnail = proxyImageUrl(r.thumbnail, req);
      if (r.banner) r.banner = proxyImageUrl(r.banner, req);
    }

    send(res, { query: q, category, count: results.length, results });
  } catch (err) {
    console.error(`[API] Search error: ${err.message}`);
    sendError(res, 500, err.message);
  }
});



app.get("/api/detail/movie", async (req, res) => {
  try {
    const { title, year, metadataTitle, url, quality } = req.query;
    if (!title) return sendError(res, 400, "Parameter 'title' is required");

    const detail = await movieDetailService.getDetail({ title, year: parseInt(year) || null, metadataTitle, url, quality });
    if (!detail) return sendError(res, 404, "No detail found");

    if (detail.poster) detail.poster = proxyImageUrl(detail.poster, req);
    if (detail.backdrop) detail.backdrop = proxyImageUrl(detail.backdrop, req);

    send(res, detail);
  } catch (err) {
    console.error(`[API] Movie detail error: ${err.message}`);
    sendError(res, 500, err.message);
  }
});


app.get("/api/sources", (req, res) => {
  const sources = SOURCES.filter(s => s.enabled !== false).map(s => ({
    name: s.name,
    description: s.description,
    categoria: s.categoria,
  }));
  send(res, { sources });
});

// ─── Filtro de catálogo local (año/texto) — paridad con movies-series ──
// Sirve "ver más" desde el catálogo SQLite persistente sin re-scraping.
app.get("/api/filter", async (req, res) => {
  try {
    const { year, anio, q, page, limit } = req.query;
    const { getKdramaFilterService } = require("./src/services/catalog/KdramaFilterService");
    const filterService = getKdramaFilterService();
    const result = await filterService.filterCatalog({
      year: year || anio,
      q,
      page,
      limit,
    });
    for (const r of result.results) {
      if (r.poster) r.poster = proxyImageUrl(r.poster, req);
      if (r.backdrop) r.backdrop = proxyImageUrl(r.backdrop, req);
    }
    send(res, result);
  } catch (err) {
    console.error(`[API] Filter error: ${err.message}`);
    sendError(res, 500, err.message);
  }
});

// ─── Relacionados — TMDB recommendations del título resuelto en el catálogo ──
app.get("/api/related", async (req, res) => {
  try {
    const { title, year, tmdbId, limit } = req.query;
    if (!title && !tmdbId) return sendError(res, 400, "Parameter 'title' or 'tmdbId' is required");

    const maxLimit = Math.min(parseInt(limit) || 12, 30);
    let id = tmdbId ? parseInt(tmdbId, 10) : null;
    let mediaType = "tv";

    // Resolver en el catálogo local primero (barato)
    const { getDetailStore } = require("./src/database/DetailStore");
    const detailStore = getDetailStore();
    if (!id) {
      const catalogId = detailStore.resolveCatalogId({ title, year: year ? parseInt(year, 10) : null });
      if (catalogId) {
        const { getCatalogStore } = require("./src/database/CatalogStore");
        const cs = getCatalogStore();
        const row = cs.db.prepare("SELECT tmdb_id, media_type FROM catalog_items WHERE id = ?").get(catalogId);
        if (row) { id = row.tmdb_id; mediaType = row.media_type || "tv"; }
      }
    }
    // Fallback: resolver vía TMDB search
    if (!id && getTMDBKey() && title) {
      const endpoint = mediaType === "movie" ? "search/movie" : "search/tv";
      const r = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, {
        params: { api_key: getTMDBKey(), query: title, language: "es-MX" }, timeout: 8000,
      }).catch(() => null);
      const hit = r && r.data && r.data.results && r.data.results[0];
      if (hit) id = hit.id;
    }
    if (!id) return send(res, { query: { title, year }, count: 0, results: [] });

    const endpoint = mediaType === "movie" ? "movie" : "tv";
    const [recRes, simRes] = await Promise.all([
      axios.get(`https://api.themoviedb.org/3/${endpoint}/${id}/recommendations`, {
        params: { api_key: getTMDBKey(), language: "es-MX", page: 1 }, timeout: 8000,
      }).catch(() => null),
      axios.get(`https://api.themoviedb.org/3/${endpoint}/${id}/similar`, {
        params: { api_key: getTMDBKey(), language: "es-MX", page: 1 }, timeout: 8000,
      }).catch(() => null),
    ]);

    const seen = new Set();
    const merged = [];
    for (const list of [recRes && recRes.data && recRes.data.results, simRes && simRes.data && simRes.data.results]) {
      for (const item of (list || [])) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push({
          id: `tmdb:${item.id}`,
          tmdbId: item.id,
          title: item.title || item.name,
          originalTitle: item.original_title || item.original_name,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
          year: (item.release_date || item.first_air_date || "").slice(0, 4) || null,
          score: item.vote_average || null,
          kind: "series",
          mediaType: "tv",
          source: "TMDB",
        });
        if (merged.length >= maxLimit) break;
      }
      if (merged.length >= maxLimit) break;
    }

    for (const r of merged) {
      if (r.poster) r.poster = proxyImageUrl(r.poster, req);
      if (r.backdrop) r.backdrop = proxyImageUrl(r.backdrop, req);
    }
    send(res, { query: { title, year, tmdbId: id }, count: merged.length, results: merged });
  } catch (err) {
    console.error(`[API] Related error: ${err.message}`);
    sendError(res, 500, err.message);
  }
});

// ─── Guardar Traducción Permanente de Episodio desde el Frontend ──
app.post(["/api/episodes/translate", "/api/episodes/save-translation"], async (req, res) => {
  try {
    const { catalogId, tmdbId, title, season, episode, titleEs, overviewEs, stillPath } = req.body;
    if ((!catalogId && !tmdbId && !title) || episode == null) {
      return sendError(res, 400, "Missing required parameters: episode and catalogId/tmdbId/title");
    }

    const { getCatalogStore } = require("./src/database/CatalogStore");
    const { getDetailStore } = require("./src/database/DetailStore");

    const catalogStore = getCatalogStore();
    const detailStore = getDetailStore();

    let catId = catalogId;
    if (!catId) {
      catId = detailStore.resolveCatalogId({ tmdbId, mediaType: "tv", title });
    }
    if (!catId) {
      return sendError(res, 404, "Series catalog record not found");
    }

    const saved = catalogStore.saveEpisodeTranslation({
      catalogId: catId,
      season: parseInt(season, 10) || 1,
      episodeNumber: parseInt(episode, 10),
      titleEs,
      overviewEs,
      stillPath,
    });
    send(res, { ok: true, catalogId: catId, saved });
  } catch (err) {
    console.error(`[API] Episode translate error: ${err.message}`);
    sendError(res, 500, err.message);
  }
});

app.get("/api/subscriptions/:userId", (req, res) => {
  const { userId } = req.params;
  const subs = notifications.getSubscriptions(userId);
  res.json({ userId, subscriptions: subs });
});

app.post("/api/subscriptions/:userId", (req, res) => {
  const { userId } = req.params;
  const { title, url, source } = req.body;
  if (!title || !url || !source) {
    return res.status(400).json({ error: "title, url, and source are required" });
  }
  const ok = notifications.addSubscription(userId, { title, url, source });
  res.json({ ok, message: ok ? "Subscribed" : "Already subscribed" });
});

app.delete("/api/subscriptions/:userId", (req, res) => {
  const { userId } = req.params;
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });
  const ok = notifications.removeSubscription(userId, url);
  res.json({ ok, message: ok ? "Unsubscribed" : "Not found" });
});


app.get("/api/titles/movie", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return sendError(res, 400, "Query parameter 'q' is required");
    const titles = await getMovieTitles(q);
    send(res, titles);
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

app.get("/api/episodes", async (req, res) => {
  try {
    const { url, source, title, fullTitle, tmdbId, season, altTitle, year } = req.query;
    if (!url || !source) {
      return res.status(400).json({ error: "Parameters 'url' and 'source' are required" });
    }
    console.log(`[Episodes] ${source}: ${url}${title ? ` (title: ${title})` : ""}${tmdbId ? ` (tmdbId: ${tmdbId})` : ""}`);
    const result = await episodeService.getEpisodes(url, source, { title, fullTitle, altTitle, tmdbId: tmdbId ? parseInt(tmdbId, 10) : null, season: season ? parseInt(season, 10) : null, year: year ? parseInt(year, 10) : null });
    // Proxy external thumbnails
    if (result && !result.error && result.episodes) {
      console.log(`[Episodes] Returning seasonAirDate: "${result.seasonAirDate}" for "${title || result.slug}"`);
      result.episodes.forEach(ep => {
        if (ep.thumbnail) ep.thumbnail = proxyImageUrl(ep.thumbnail, req);
      });
    }
    res.json(result);
  } catch (err) {
    console.error(`[Episodes] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/extract", async (req, res) => {
  try {
    const { url, source } = req.query;
    if (!url || !source) {
      return res.status(400).json({ error: "Parameters 'url' and 'source' are required" });
    }

    const serverBase = `http://${req.headers.host}`;
    const wrapProxyUrl = (u) => {
      if (!u) return u;
      if (u.includes("zilla-networks.com") || u.includes("animeav1.com") || (u.includes(".m3u8") && !u.includes("/api/hls/"))) {
        if (!u.includes("/api/hls/stream.m3u8")) {
          return `${serverBase}/api/hls/stream.m3u8?url=${encodeURIComponent(u)}`;
        }
      }
      // Proxy mp4upload/mp4load URLs (require Referer header that native players can't set)
      if ((u.includes("mp4upload.com") || u.includes("mp4load.com")) && !u.includes("/api/proxy/video")) {
        return `${serverBase}/api/proxy/video?url=${encodeURIComponent(u)}`;
      }
      return u;
    };

    const cacheKey = `${source}:${url}`;
    const cached = extractCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const resData = { ...cached.result };
      resData.url = wrapProxyUrl(resData.url);
      if (resData.tracks && resData.tracks.length > 0) {
        resData.tracks = resData.tracks.map(t => ({ ...t, url: wrapProxyUrl(t.url) }));
      }
      return res.json(resData);
    }

    console.log(`[Extract] ${source}: ${url}`);
    const result = await extractService.extract(url, source);

    result.url = wrapProxyUrl(result.url);
    if (result.tracks && result.tracks.length > 0) {
      result.tracks = result.tracks.map(t => ({ ...t, url: wrapProxyUrl(t.url) }));
    }

    extractCache.set(cacheKey, { result, timestamp: Date.now() });
    console.log(`[Extract] OK: ${result.url}`);
    res.json(result);
  } catch (err) {
    console.error(`[Extract] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Resolve Episode URL for Source Switch ────────────────
app.get("/api/resolve-episode", async (req, res) => {
  try {
    const { url, source, episode } = req.query;
    if (!url || !source || !episode) {
      return res.status(400).json({ error: "Parameters 'url', 'source', and 'episode' are required" });
    }

    const epNum = parseInt(episode, 10);
    if (isNaN(epNum)) return res.status(400).json({ error: "Invalid episode number" });

    const result = await getEpisodes(url, source);
    if (result.error) return res.status(500).json({ error: result.error });

    const ep = result.episodes?.find(e => e.number === epNum);
    if (!ep || !ep.url) {
      return res.status(404).json({ error: `Episode ${epNum} not found for ${source}` });
    }

    res.json({ episodeUrl: ep.url });
  } catch (err) {
    console.error(`[Resolve-Episode] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── On-Demand Streaming HLS Proxy ──────────────────────────
// Fixes Zilla Networks sending 'Content-Type: text/html' on video segments
// (which causes libmpv/ffmpeg to abort stream playback after ~21s).
// Preserves #EXT-X-MAP so ffmpeg's HLS demuxer seeks natively without moov errors.

function resolveHLSUrl(targetUrl, baseUrl) {
  if (!targetUrl) return targetUrl;
  if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) return targetUrl;
  try {
    return new URL(targetUrl, baseUrl).href;
  } catch {
    return targetUrl;
  }
}

app.get("/api/hls/stream.m3u8", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");

    const { data: m3u8 } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://animeav1.com/",
      },
      timeout: 30000,
    });

    const serverBase = `http://${req.headers.host}`;

    // Helper to determine if a URL in the playlist is another playlist or a segment
    const isPlaylist = (u) => u.includes(".m3u8") || u.includes("playlist");

    // Rewrite EXT-X-MAP URI
    let rewritten = m3u8.replace(/#EXT-X-MAP:URI="([^"]+)"/g, (match, initUrl) => {
      const absInit = resolveHLSUrl(initUrl, url);
      return `#EXT-X-MAP:URI="${serverBase}/api/hls/segment?url=${encodeURIComponent(absInit)}"`;
    });

    // Rewrite URLs (relative or absolute)
    // We match lines that don't start with # and aren't empty
    rewritten = rewritten.replace(/^(?!#)([^\s]+)$/gm, (match) => {
      const target = match.trim();
      const absUrl = resolveHLSUrl(target, url);
      if (isPlaylist(target)) {
        return `${serverBase}/api/hls/stream.m3u8?url=${encodeURIComponent(absUrl)}`;
      } else {
        return `${serverBase}/api/hls/segment?url=${encodeURIComponent(absUrl)}`;
      }
    });

    res.set("Content-Type", "application/vnd.apple.mpegurl");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=5"); // Playlists change, but can be cached briefly
    res.send(rewritten);
  } catch (err) {
    console.error(`[HLS Stream Proxy] Playlist error: ${err.message}`);
    res.status(502).send("Proxy error");
  }
});

const hlsSegmentCache = new Map();
const MAX_HLS_CACHE_SIZE = 200;

app.get("/api/hls/segment", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");

    // Check memory cache
    if (hlsSegmentCache.has(url)) {
      const { data, contentType } = hlsSegmentCache.get(url);
      res.set("Content-Type", contentType);
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cache-Control", "public, max-age=3600, immutable");
      return res.send(data);
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://animeav1.com/",
    };

    const isInit = url.includes("init.html") || url.includes("init.mp4") || url.includes(".m4s");
    const contentType = isInit ? "video/mp4" : "video/mp2t";

    const segRes = await axios.get(url, {
      headers,
      responseType: "arraybuffer", // Use arraybuffer for easier caching
      timeout: 30000,
    });

    const data = Buffer.from(segRes.data);

    // Store in cache
    if (hlsSegmentCache.size >= MAX_HLS_CACHE_SIZE) {
      const firstKey = hlsSegmentCache.keys().next().value;
      hlsSegmentCache.delete(firstKey);
    }
    hlsSegmentCache.set(url, { data, contentType });

    res.set("Content-Type", contentType);
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=3600, immutable");
    res.send(data);
  } catch (err) {
    console.error(`[HLS Stream Proxy] Segment error: ${err.message} URL: ${req.query.url}`);
    res.status(502).send("Proxy error");
  }
});



app.get("/api/omdb/episode", async (req, res) => {
  try {
    const { imdbId, title, malId, season, episode } = req.query;
    if (!imdbId && !title) {
      return res.status(400).json({ error: "Parameters 'imdbId' or 'title' are required" });
    }
    const result = await getEpisodeSynopsis({ imdbId, title, malId, season, episode });
    res.json(result);
  } catch (err) {
    console.error(`[OMDb Episode] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/omdb/season", async (req, res) => {
  try {
    const { imdbId, title, malId, season, enrich } = req.query;
    if (!imdbId && !title) {
      return res.status(400).json({ error: "Parameters 'imdbId' or 'title' are required" });
    }
    const isEnrich = enrich === "true" || enrich === "1";
    const result = await getSeasonEpisodes({ imdbId, title, malId, season, enrich: isEnrich });
    res.json(result);
  } catch (err) {
    console.error(`[OMDb Season] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/omdb/cache-stats", (req, res) => {
  res.json(getOmdbCacheStats());
});

// ─── Image Proxy ──────────────────────────────────────────
const imageProxyCache = new Map();
const IMAGE_PROXY_CACHE_MAX = 200;
const IMAGE_PROXY_CACHE_TTL = 10 * 60 * 1000;

app.get("/api/proxy/image", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");

    if (imageProxyCache.has(url)) {
      const cached = imageProxyCache.get(url);
      if (Date.now() - cached.timestamp < IMAGE_PROXY_CACHE_TTL) {
        res.set("Content-Type", cached.contentType);
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "public, max-age=600");
        return res.send(cached.data);
      }
      imageProxyCache.delete(url);
    }

    let referer = "https://www.google.com/";
    try { referer = new URL(url).origin + "/"; } catch {}

    const imgRes = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: referer,
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      timeout: 15000,
    });

    const contentType = imgRes.headers["content-type"] || "image/jpeg";
    const data = Buffer.from(imgRes.data);

    if (imageProxyCache.size >= IMAGE_PROXY_CACHE_MAX) {
      const firstKey = imageProxyCache.keys().next().value;
      imageProxyCache.delete(firstKey);
    }
    imageProxyCache.set(url, { data, contentType, timestamp: Date.now() });

    res.set("Content-Type", contentType);
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=600");
    res.send(data);
  } catch (err) {
    console.error(`[Image Proxy] Error fetching ${req.query.url}: ${err.message}`);
    res.status(502).send("Proxy error");
  }
});

// ─── Video Proxy (For Web CORS Bypass) ──────────────────────
app.get("/api/proxy/video", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    // Auto-inyección de Referer para dominios que lo requieren
    if (url.includes("animethemes.moe")) {
      headers["Referer"] = "https://animethemes.moe/";
    } else if (url.includes("mp4upload.com") || url.includes("mp4load.com")) {
      headers["Referer"] = "https://www.mp4upload.com/";
    }

    // Soporte para Seeking (Rango de bytes)
    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }

    const videoRes = await axios({
      method: "get",
      url: url,
      responseType: "stream",
      headers: headers,
      timeout: 30000,
    });

    // Reenviar status y headers críticos de media
    res.status(videoRes.status);
    if (videoRes.headers["content-type"]) res.set("Content-Type", videoRes.headers["content-type"]);
    if (videoRes.headers["content-length"]) res.set("Content-Length", videoRes.headers["content-length"]);
    if (videoRes.headers["accept-ranges"]) res.set("Accept-Ranges", videoRes.headers["accept-ranges"]);
    if (videoRes.headers["content-range"]) res.set("Content-Range", videoRes.headers["content-range"]);

    // CORS
    res.set("Access-Control-Allow-Origin", "*");

    videoRes.data.pipe(res);
  } catch (err) {
    console.error(`[Video Proxy] Error: ${err.message} URL: ${req.query.url}`);
    if (!res.headersSent) {
      res.status(err.response?.status || 502).send("Proxy error");
    }
  }
});

function proxyImageUrl(rawUrl, req) {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.startsWith("http")) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return rawUrl;
  } catch { return rawUrl; }
  // Construir la URL pública con el host real de la petición (detrás de Caddy:
  // x-forwarded-proto/x-forwarded-host; en acceso directo: req.headers.host).
  const proto = (req && (req.headers["x-forwarded-proto"] || req.protocol)) || "http";
  const host = (req && (req.headers["x-forwarded-host"] || req.headers.host)) || `localhost:${PORT}`;
  return `${proto}://${host}/api/proxy/image?url=${encodeURIComponent(rawUrl)}`;
}

app.post("/api/clear-cache", (req, res) => {
  searchCache.clear();
  extractCache.clear();
  metaCache.clear();
  clearEpisodesCache();
  imageProxyCache.clear();
  res.json({ success: true, message: "All caches cleared" });
});

app.get("/api/health", async (req, res) => {
  try {
    const { toHealthDTO } = require("./src/dto/HealthDTO");
    const providers = [
      { provider: "TMDB", status: "ONLINE", responseTime: 0 },
      { provider: "OMDb", status: "ONLINE", responseTime: 0 },
    ];
    send(res, toHealthDTO(providers));
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

const server = app.listen(PORT, async () => {
  console.log(`🎬 Auris Server running on http://localhost:${PORT}`);

  // Calentamiento de trending en segundo plano
  try {
    await getTrendingByCategory("kdrama");
  } catch (err) {
    console.error(`[Warming] Error: ${err.message}`);
  }

  console.log(`📡 Endpoints:`);
  console.log(`   GET  /api/search/:category?q=         Search (kdrama, all)`);
  console.log(`   GET  /api/detail/movie?title=&url=     Movie/Series TMDB detail`);
  console.log(`   GET  /api/sources                      List available sources`);
  console.log(`   GET  /api/titles/movie?q=              Movie/Series title resolution`);
  console.log(`   GET  /api/episodes?url=&source=        List episodes for a page`);
  console.log(`   GET  /api/extract?url=&source=         Extract video URL from episode page`);
  console.log(`   GET  /api/omdb/episode?title=&season=&episode= Episode synopsis from OMDb`);
  console.log(`   GET  /api/omdb/season?title=&season=  Season episode list from OMDb`);
  console.log(`   GET  /api/health                       Health check`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Puerto ${PORT} ocupado. Liberando automáticamente...`);
    const { spawnSync } = require("child_process");
    try {
      const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf-8", shell: false });
      const lines = (netstat.stdout || "").split("\n");
      const listening = lines.find((l) => l.includes(`:${PORT}`) && l.includes("LISTENING"));
      const pid = listening ? listening.trim().split(/\s+/).pop() : null;
      if (pid && /^\d+$/.test(pid) && parseInt(pid) !== process.pid) {
        spawnSync("taskkill", ["/PID", pid, "/F"], { shell: false });
        console.log(`✅ Proceso ${pid} liberado. Reiniciando en 1.5 segundos...`);
        setTimeout(() => { server.listen(PORT); }, 1500);
      } else {
        console.error("No se encontró el PID que ocupa el puerto. Saliendo...");
        process.exit(1);
      }
    } catch (e) {
      console.error(`Error al liberar puerto: ${e.message}. Saliendo...`);
      process.exit(1);
    }
  } else {
    console.error(`[Server Error] ${err.message}`);
    process.exit(1);
  }
});
