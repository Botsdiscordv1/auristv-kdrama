/**
 * services/omdb.js
 * Servicio de integración con OMDb API y TMDB para metadata de episodios.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { OMDB_API_KEY, getTMDBKey, TMDB_API_KEY } = require("../utils/config");
const { fetchTmdbSeasonEpisodes } = require("../utils/tmdb-season");
const { isGenericEpisodeName, splitSyl } = require("../utils/title-utils");

const tmdbIdCache = new Map();

async function getTMDBSeasonData(title, season, originalTitle) {
  if (!getTMDBKey()) return null;
  const rawSearch = title
    .replace(/\s+(?:[0-9]+)(?:st|nd|rd|th)?\s+season|season\s+([0-9]+)|s([0-9]+)\b/i, "")
    .replace(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)(?=\s*[:–—-]|\s*$)/i, "")
    .replace(/\s+\d+$/g, "").replace(/[!?¡¿]/g, "").trim();
  const searchTitle = splitSyl(rawSearch);
    const arcKeywords = [
      "shimetsu", "kaiyuu", "zenpen", "kouhen", "recap", "special", "especial", "ova", "oad", "arc", "hen",
    ];
    const activeKeywords = [
      ...arcKeywords.filter(kw => (originalTitle || title || "").toLowerCase().includes(kw)),
    ];

  try {
    const searchRes = await axios.get("https://api.themoviedb.org/3/search/tv", {
      params: { api_key: getTMDBKey(), query: searchTitle, language: "en-US" },
      timeout: 6000,
    });
    const results = searchRes.data.results || [];
    let show = null;
    if (results.length > 0) {
      const normalize = (str) =>
        str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, " ") : "";
      const normQ = normalize(searchTitle);

      const scored = results.map(r => {
        const name = normalize(r.name);
        const origName = normalize(r.original_name);
        let score = 0;
        if (name === normQ || origName === normQ) {
          score += 1000;
        } else if (name.includes(normQ) || origName.includes(normQ) || normQ.includes(name) || normQ.includes(origName)) {
          score += 100;
        }
        const isAnim = (r.genre_ids || []).includes(16);
        const isJa = (r.original_language === 'ja');
        if (isAnim) score += 50;
        if (isJa) score += 30;
        score += (r.popularity || 0) / 100;
        return { item: r, score };
      });

      scored.sort((a, b) => b.score - a.score);
      show = scored[0]?.item;
    }
    if (!show) return null;

    // Obtener detalles del show para ver cuántas temporadas tiene
    const showDetailRes = await axios.get(`https://api.themoviedb.org/3/tv/${show.id}`, {
      params: { api_key: getTMDBKey() },
      timeout: 5000,
    });
    const totalSeasonsOnTMDB = showDetailRes.data.number_of_seasons || 1;

    let targetSeason = season;
    let isMerged = false;
    let autoSplit = false;

    if (season > totalSeasonsOnTMDB) {
      console.log(`[TMDB] Temporada ${season} no existe en TMDB para "${searchTitle}" (total: ${totalSeasonsOnTMDB}). Buscando fusión en Season 1...`);
      targetSeason = 1;
      isMerged = true;
    } else if (season === 1 && totalSeasonsOnTMDB === 1 && activeKeywords.length > 0) {
      console.log(`[TMDB] Auto-split: temporada 1 con keywords de arco detectadas en "${originalTitle || title}"`);
      autoSplit = true;
      targetSeason = 1;
    }

    const seasonPack = await fetchTmdbSeasonEpisodes(show.id, targetSeason, getTMDBKey);
    if (!seasonPack?.tmdbEpisodes?.length) return null;

    let rawEpisodes = seasonPack.tmdbEpisodes;
    let esEpisodes = seasonPack.localizedEpisodes || [];

    // Dividir por fecha de estreno (> 60 días) para temporadas fusionadas o auto-split
    if ((isMerged || autoSplit) && targetSeason === 1) {
        const sorted = [...rawEpisodes].sort((a, b) => new Date(a.air_date) - new Date(b.air_date));
        const groups = [];
        let currentGroup = [];
        let prevDate = null;

        for (const ep of sorted) {
          if (!ep.air_date) { currentGroup.push(ep); continue; }
          const currDate = new Date(ep.air_date);
          if (prevDate && Math.abs(currDate - prevDate) / (1000 * 60 * 60 * 24) > 60) {
            groups.push(currentGroup);
            currentGroup = [];
          }
          currentGroup.push(ep);
          prevDate = currDate;
        }
        if (currentGroup.length > 0) groups.push(currentGroup);

        if (isMerged) {
          if (season <= groups.length) {
            rawEpisodes = groups[season - 1];
          } else {
            return null;
          }
        } else if (autoSplit) {
          // Generar keywords adicionales desde el título de búsqueda
          const titleWords = (originalTitle || title).toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3 && !["with","that","this","from","they","what","about","which","when","after","before","jujutsu","kaisen","season","temporada","part","parte","cour","anime","series","movie","film","the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","have","been","more","some","them","their","then","very","just","also","would","could","should","than","into","over","such","only","other","than","will","each","made","like","first","second","third","fourth"].includes(w));

          const allKeywords = [...new Set([...activeKeywords, ...titleWords])];

          let bestBatch = null;
          let bestScore = 0;
          for (let i = 0; i < groups.length; i++) {
            const batch = groups[i];
            const score = batch.reduce((sum, ep) => {
              const text = ((ep.name || "") + " " + (ep.overview || "")).toLowerCase();
              return sum + allKeywords.filter(kw => text.includes(kw)).length;
            }, 0);
            if (score > bestScore) {
              bestScore = score;
              bestBatch = i;
            }
          }
          if (bestBatch !== null && bestScore > 0) {
            rawEpisodes = groups[bestBatch];
            console.log(`[TMDB] Auto-split: batch ${bestBatch + 1} (score ${bestScore}) para "${originalTitle || title}"`);
          } else {
            // Fallback: usar el ÚLTIMO batch
            rawEpisodes = groups[groups.length - 1];
            console.log(`[TMDB] Auto-split: sin match, usando último batch (batch ${groups.length}).`);
          }
        }

        // Renumerar episodios del batch a 1, 2, 3...
        const batchIds = new Set(rawEpisodes.map(e => e.id));
        esEpisodes = esEpisodes.filter(e => batchIds.has(e.id));
        rawEpisodes = rawEpisodes.map((ep, idx) => ({ ...ep, episode_number: idx + 1 }));
        // Reindexar esEpisodes para que coincidan con rawEpisodes
        esEpisodes = esEpisodes.map((ep, idx) => ({ ...ep, episode_number: idx + 1 }));
    }

    const episodes = rawEpisodes.map((enEp, idx) => {
        const esEp = esEpisodes.find(e => e.episode_number === enEp.episode_number) || esEpisodes[idx];
        const title = isGenericEpisodeName(esEp?.name) && !isGenericEpisodeName(enEp.name) ? enEp.name : (esEp?.name || enEp.name);
        const desc = isGenericEpisodeName(esEp?.overview) && !isGenericEpisodeName(enEp.overview) ? enEp.overview : (esEp?.overview || enEp.overview);
        return {
            episode: isMerged ? idx + 1 : enEp.episode_number,
            realEpisodeNumber: enEp.episode_number,
            title,
            titleEn: enEp.name,
            description: desc,
            descriptionEn: enEp.overview,
            synopsis: desc,
            thumbnail: enEp.still_path ? `https://image.tmdb.org/t/p/w780${enEp.still_path}` : null,
            released: enEp.air_date || null,
            runtime: enEp.runtime || null,
            duration: enEp.runtime ? `${enEp.runtime} min` : null
        };
    });

    return { tmdbId: show.id, episodes, isMerged };
  } catch (err) {
    console.error(`[TMDB Error] ${err.message}`);
    return null;
  }
}

const CACHE_FILE = path.join(__dirname, "../data/omdb-cache.json");
let cache = new Map();

function loadCacheFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const json = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      for (const [key, val] of Object.entries(json)) cache.set(key, val);
    }
  } catch {}
}
function saveCacheToDisk() {
  try {
    const obj = Object.fromEntries(cache.entries());
    if (!fs.existsSync(path.dirname(CACHE_FILE))) fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch {}
}

loadCacheFromDisk();

function buildCacheKey(title, season) {
  const clean = title.trim().toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  return `title:${clean}:s${season}`;
}

async function resolveEnglishTitle(rawTitle) {
  return rawTitle;
}

async function getSeasonEpisodes({ title, season = 1 }) {
  let sNum = parseInt(season, 10) || 1;
  const cleanBase = title.replace(/\((TV|Pelicula|Movie|OVA|ONA|Especial|En emisión|Finalizado|Latino|Sub)\)/gi, "").replace(/[!¡?¿]/g, "").trim();
  const cleanBaseExpanded = splitSyl(cleanBase);
  let resolvedTitle = await resolveEnglishTitle(cleanBaseExpanded);
  const seasonMatch = resolvedTitle.match(/\s+(?:([0-9]+)(?:st|nd|rd|th)?\s+season|season\s+([0-9]+)|s([0-9]+))\b/i);
  if (seasonMatch) {
      const detectedS = parseInt(seasonMatch[1] || seasonMatch[2] || seasonMatch[3], 10);
      if (detectedS > 1) sNum = detectedS;
      resolvedTitle = resolvedTitle.replace(seasonMatch[0], "").trim();
  }
  // Detectar numeración romana (II, III, etc.) al final o antes de dos puntos/guion
  const romanMap = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const romanMatch = resolvedTitle.match(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)(?=\s*[:–—-]|\s*$)/i);
  if (romanMatch) {
    const detectedS = romanMap[romanMatch[1].toUpperCase()];
    if (detectedS > 1 && detectedS !== sNum) sNum = detectedS;
    resolvedTitle = resolvedTitle.replace(romanMatch[0], "").trim();
  }
  const seasonKey = buildCacheKey(resolvedTitle, sNum);

  if (cache.has(seasonKey)) {
    const cached = cache.get(seasonKey);
    const eps = cached.episodes || [];

    const firstThumb = eps.length > 0 ? eps[0].thumbnail : null;
    const isCloned = eps.length > 1 && eps.every(e => e.thumbnail === firstThumb);
    const isBad = eps.length === 0 || isCloned || eps.some(e =>
        !e.description || e.description.length < 20 || e.description.includes("QUERY LENGTH") ||
        (e.title && e.title.includes("Episodio") && e.titleEn && !e.titleEn.includes("Episode"))
    );

    if (!isBad && !title.toLowerCase().includes("iruma")) return { ...cached, fromCache: true };
    console.log(`[OMDb] Purging corrupted cache for ${seasonKey}`);
    cache.delete(seasonKey);
  }

  const tmdbData = await getTMDBSeasonData(resolvedTitle, sNum, cleanBase);
  if (tmdbData?.episodes) {
    const result = { seriesTitle: resolvedTitle, season: sNum, totalEpisodes: tmdbData.episodes.length, episodes: tmdbData.episodes };
    cache.set(seasonKey, result);
    saveCacheToDisk();
    return result;
  }
  return { error: "No metadata found", totalEpisodes: 0, episodes: [] };
}

module.exports = { getSeasonEpisodes, resolveEnglishTitle, getCacheStats: () => ({ totalCachedEntries: cache.size }) };
