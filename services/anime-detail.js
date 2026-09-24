/**
 * services/anime-detail.js
 * Fetches enriched metadata for movies/series (TMDB only).
 * Pruned for the movies/kdramas server partition.
 */

const axios = require("axios");
const { getTMDBKey } = require("../utils/config");
const { getCatalogStore } = require("../src/database/CatalogStore");
const { getDetailStore } = require("../src/database/DetailStore");
const { redisGet, redisSet } = require("../src/cache/RedisCache");

function normalizeTitleKey(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").trim();
}

// --- Caché en memoria ---------------------------------------------------
const movieSeriesDetailCache = new Map();
const MOVIE_CACHE_TTL = 30 * 60 * 1000;

movieSeriesDetailCache.clear();

// ============================================================
//  MOVIE/SERIES DETAIL — fetchMovieSeriesDetail
// ============================================================

async function fetchMovieSeriesDetail(item) {
  if (!getTMDBKey()) return null;

  const title = item.title;
  const rawTitle = item.metadataTitle || title || "";

  // El cliente a veces envía el año embebido en el título
  const yearMatch = rawTitle.match(/\((\d{4})\)/);
  const extractedYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const searchTitle = rawTitle
    .replace(/\(\d{4}\)/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const effectiveYear = item.year || extractedYear;
  const categoryHint = (item.category || "").toLowerCase();

  const cacheKey = `${searchTitle}:${effectiveYear || ""}:${categoryHint}`;
  const cached = movieSeriesDetailCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < MOVIE_CACHE_TTL) {
    console.log(`[Kdramas Cache] HIT: "${cacheKey}"`);
    return cached.data;
  }

  // SQLite L1/L2 persistente (igual que movies-series)
  const catalogStore = getCatalogStore();
  const detailStore = getDetailStore();
  const resolvedId = detailStore.resolveCatalogId({ title: searchTitle, year: effectiveYear, tmdbId: item.tmdbId, mediaType: item.mediaType });
  if (resolvedId) {
    const dbDetail = detailStore.getDetail(resolvedId);
    if (dbDetail && dbDetail.data && !dbDetail.isStale) {
      console.log(`[Kdramas SQLite] HIT: "${searchTitle}"`);
      movieSeriesDetailCache.set(cacheKey, { data: dbDetail.data, timestamp: Date.now() });
      return dbDetail.data;
    }
  }

  // Redis L2 cache (sobrevive a reinicios de PM2)
  const redisCached = await redisGet(`kd:${cacheKey}`);
  if (redisCached) {
    console.log(`[Kdramas Redis] HIT: "${cacheKey}"`);
    movieSeriesDetailCache.set(cacheKey, { data: redisCached, timestamp: Date.now() });
    return redisCached;
  }

  let tmdbMovie = null;
  let tmdbTV = null;
  let mediaType = null;
  let tmdbId = null;

  try {
    const [movieSearch, tvSearch] = await Promise.all([
      axios.get("https://api.themoviedb.org/3/search/movie", {
        params: { api_key: getTMDBKey(), query: searchTitle, language: "es-MX" },
        timeout: 5000,
      }).catch(() => ({ data: { results: [] } })),
      axios.get("https://api.themoviedb.org/3/search/tv", {
        params: { api_key: getTMDBKey(), query: searchTitle, language: "es-MX" },
        timeout: 5000,
      }).catch(() => ({ data: { results: [] } })),
    ]);

    const movieResults = movieSearch.data.results || [];
    const tvResults = tvSearch.data.results || [];

    const urlLower = (item.url || "").toLowerCase();
    const qualityLower = (item.quality || "").toLowerCase();
    const isSeriesUrl = urlLower.includes("/serie") || qualityLower.includes("serie");
    const isMovieUrl = urlLower.includes("/pelicula") || qualityLower.includes("pelicula") || qualityLower.includes("movie");

    const scoreMatch = (results, query) => {
      const qNorm = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const queryHasNumber = /\b(2|3|4|5|ii|iii|iv|part\s*\d|parte\s*\d)\b/i.test(qNorm);
      const baseName = qNorm.replace(/\s*[-–:]\s*.+$/g, "").replace(/\s*\d+\s*$/g, "").replace(/\s*(ii|iii|iv|part\s*\d+|parte\s*\d+)\s*$/gi, "").trim();
      return results.map(r => {
        const t = ((r.title || r.name || "") + " " + (r.original_title || r.original_name || "")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const year = (r.release_date || r.first_air_date || "").slice(0, 4);
        const queryYear = item.year ? String(item.year) : "";

        const hasExactYear = queryYear && year === queryYear;
        const resultIsSequel = /\b(2|3|4|5|ii|iii|iv|part\s*\d+|parte\s*\d+)\b/i.test(t);

        let sequelPenalty = 0;
        if (!queryHasNumber && resultIsSequel) sequelPenalty = -200;

        let yearScore = 0;
        if (queryYear) {
          if (hasExactYear) yearScore = 500;
          else if (year) yearScore = -100;
        }

        const baseMatch = baseName.length > 3 && t.includes(baseName);
        const exactTitleMatch = t.includes(qNorm);

        const qWords = qNorm.split(/\s+/).filter(w => w.length > 2);
        const wordHits = qWords.filter(w => t.includes(w)).length;

        let score = 0;
        if (exactTitleMatch) score += 200;
        if (baseMatch) score += 100;
        score += wordHits * 15;
        score += yearScore;
        score += sequelPenalty;
        if (hasExactYear) score += r.popularity ? r.popularity / 10 : 0;

        return { item: r, score, hasExactYear, resultIsSequel };
      }).sort((a, b) => b.score - a.score);
    };

    const scoredMovies = scoreMatch(movieResults, searchTitle);
    const scoredTV = scoreMatch(tvResults, searchTitle);

    const bestMovie = scoredMovies[0];
    const bestTV = scoredTV[0];

    if (isSeriesUrl && bestTV?.score > 0) {
      mediaType = "tv"; tmdbId = bestTV.item.id;
    } else if (isMovieUrl && bestMovie?.score > 0) {
      mediaType = "movie"; tmdbId = bestMovie.item.id;
    } else if (bestMovie && bestTV) {
      if (bestMovie.score >= bestTV.score) { mediaType = "movie"; tmdbId = bestMovie.item.id; }
      else { mediaType = "tv"; tmdbId = bestTV.item.id; }
    } else if (bestMovie) { mediaType = "movie"; tmdbId = bestMovie.item.id; }
    else if (bestTV) { mediaType = "tv"; tmdbId = bestTV.item.id; }
  } catch (err) {
    console.warn(`[MovieSeries Search] Error: ${err.message}`);
  }

  if (!tmdbId || !mediaType) return null;

  let detail = null;
  try {
    const endpoint = mediaType === "movie" ? "movie" : "tv";
    const extraParams = mediaType === "movie"
      ? "videos,credits,watch/providers,release_dates,external_ids,images"
      : "videos,credits,watch/providers,content_ratings,external_ids,images";
    const { data } = await axios.get(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}`, {
      params: { api_key: getTMDBKey(), language: "es-MX", append_to_response: extraParams },
      timeout: 6000,
    });
    detail = data;
  } catch (err) {
    try {
      const endpoint = mediaType === "movie" ? "movie" : "tv";
      const { data } = await axios.get(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}`, {
        params: { api_key: getTMDBKey(), language: "es-MX" },
        timeout: 6000,
      });
      detail = data;
    } catch { return null; }
  }

  const isMovie = mediaType === "movie";
  const finalTitle = isMovie ? (detail.title || detail.original_title) : (detail.name || detail.original_name);
  const originalTitle = isMovie ? detail.original_title : detail.original_name;
  const releaseDate = isMovie ? detail.release_date : detail.first_air_date;
  const runtime = isMovie ? detail.runtime : null;
  const episodeRuntime = !isMovie && detail.episode_run_time?.length ? detail.episode_run_time[0] : null;
  const rating = detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null;
  const voteCount = detail.vote_count || 0;
  const genresArr = (detail.genres || []).map(g => g.name);
  const productionCompanies = (detail.production_companies || []).map(c => c.name);
  const status = detail.status || null;
  const languages = detail.spoken_languages?.map(l => l.english_name) || [];
  const overview = detail.overview || null;
  const poster = null;
  const backdrop = detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : null;
  const homepage = detail.homepage || null;

  const cast = (detail.credits?.cast || []).slice(0, 5).map(c => ({
    name: c.name,
    character: c.character,
    profile: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
  }));

  const directors = isMovie
    ? (detail.credits?.crew || []).filter(c => c.job === "Director").map(c => c.name)
    : (detail.created_by || []).map(c => c.name);

  const seasons = !isMovie ? (detail.seasons || []).filter(s => s.season_number > 0).map(s => ({
    seasonNumber: s.season_number,
    name: s.name,
    episodeCount: s.episode_count,
    airDate: s.air_date,
    poster: null,
  })) : [];

  const totalSeasons = !isMovie ? (detail.number_of_seasons || 0) : null;
  const totalEpisodes = !isMovie ? (detail.number_of_episodes || null) : null;

  let certification = null;
  if (isMovie && detail.release_dates?.results) {
    const usRelease = detail.release_dates.results.find(r => r.iso_3166_1 === "US");
    if (usRelease?.release_dates?.length) certification = usRelease.release_dates[0].certification;
  } else if (!isMovie && detail.content_ratings?.results) {
    const usRating = detail.content_ratings.results.find(r => r.iso_3166_1 === "US");
    if (usRating) certification = usRating.rating;
  }

  const platforms = [];
  if (detail["watch/providers"]?.results) {
    const regions = ["US", "MX", "ES", "AR", "CO", "CL"];
    for (const region of regions) {
      const providerData = detail["watch/providers"].results[region];
      if (providerData) {
        const allProviders = [
          ...(providerData.flatrate || []),
          ...(providerData.rent || []),
          ...(providerData.buy || []),
        ];
        for (const p of allProviders) {
          if (!platforms.some(x => x.providerName === p.provider_name)) {
            platforms.push({ providerName: p.provider_name, logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null });
          }
        }
      }
    }
  }

  let trailerKey = null;
  let trailerType = null;
  const isBadVideo = (videoName) => {
    const vNorm = videoName.toLowerCase();
    if (/\b(castellano|españa|español\s*españa|spanish\s*spain|es-es|es\s*españa)\b/i.test(vNorm)) return true;
    if (/\b(2|3|4|5|ii|iii|iv|part\s*\d+|parte\s*\d+)\b/i.test(vNorm)) return true;
    return false;
  };

  const isSequelMovie = (videoName, movieTitle) => {
    const vNorm = videoName.toLowerCase();
    const mNorm = movieTitle.toLowerCase();
    const sequelWords = /\b(return|returns|reboot|remake|regreso|el\s*regreso|la\s*vuelta)\b/i;
    if (sequelWords.test(vNorm) && !sequelWords.test(mNorm)) return true;
    const vHasNum = /\b(\d+)\b/.test(vNorm);
    const tHasNum = /\b(\d+)\b/.test(mNorm);
    if (vHasNum && tHasNum) {
      const vNum = parseInt(vNorm.match(/\b(\d+)\b/)?.[1] || "0", 10);
      const tNum = parseInt(mNorm.match(/\b(\d+)\b/)?.[1] || "0", 10);
      if (vNum > 0 && tNum > 0 && vNum !== tNum) return true;
    }
    return false;
  };

  if (detail.videos?.results) {
    const movieTitle = finalTitle || originalTitle || "";
    const ytVideos = detail.videos.results
      .filter(v => v.site === "YouTube" && v.type === "Trailer")
      .filter(v => {
        if (isBadVideo(v.name)) return false;
        if (isSequelMovie(v.name, movieTitle)) return false;
        return true;
      });

    const prioritized = [
      ytVideos.find(v => /trailer/i.test(v.name) && /(latino|español\s*latino|subtitulado|mx|argentina|colombia|chile|perú)/i.test(v.name)),
      ytVideos.find(v => /tráiler\s+oficial/i.test(v.name)),
      ytVideos.find(v => /official\s+trailer/i.test(v.name) && /(sub|subtitle)/i.test(v.name)),
      ytVideos.find(v => /official\s+trailer/i.test(v.name)),
      ytVideos.find(v => /trailer/i.test(v.name) && /(es|mx|ar|co|cl)/i.test(v.iso_639_1)),
      ytVideos.find(v => /trailer/i.test(v.name)),
      ytVideos.find(v => /teaser/i.test(v.name)),
      detail.videos.results.find(v => v.site === "YouTube"),
    ].filter(Boolean);

    if (prioritized.length > 0) {
      const chosen = prioritized[0];
      trailerKey = chosen.key;
      trailerType = chosen.name || null;
    }
  }

  const result = {
    tmdbId, mediaType, title: finalTitle, originalTitle, overview, poster, backdrop,
    rating, voteCount, releaseDate, runtime, episodeRuntime, genres: genresArr,
    productionCompanies, directors, cast, status, languages, seasons, totalSeasons,
    totalEpisodes, certification, platforms, trailerKey, trailerType, homepage, isMovie,
  };

  movieSeriesDetailCache.set(cacheKey, { data: result, timestamp: Date.now() });
  // Persistir en SQLite y Redis (fire-and-forget, sin bloquear la respuesta)
  try {
    const catId = catalogStore.upsertCatalogItem({
      tmdbId,
      mediaType: mediaType === "movie" ? "movie" : "tv",
      title: result.title,
      originalTitle: result.originalTitle,
      // Guardar variantes del título del item (puede venir en inglés/romaji desde
      // la fuente) para poder resolver aunque TMDB devuelva el título traducido.
      // CatalogStore guarda 'originalTitle' aparte; 'titleEnglish' es una variante extra.
      titleEnglish: item.title && normalizeTitleKey(item.title) !== normalizeTitleKey(result.title) ? item.title : null,
      kind: mediaType === "movie" ? "movie" : "series",
      year: effectiveYear ? parseInt(effectiveYear, 10) : null,
      score: result.rating ? parseFloat(result.rating) : null,
      overview: result.overview,
      poster: result.poster,
      backdrop: result.backdrop,
      genres: result.genres,
      cast: result.cast,
      platforms: result.platforms,
    });
    if (catId) detailStore.saveDetail(catId, 1, result);
  } catch (e) {
    console.warn(`[Kdramas SQLite] save error: ${e.message}`);
  }
  redisSet(`kd:${cacheKey}`, result, 1800).catch(() => {});
  return result;
}

module.exports = { fetchMovieSeriesDetail, movieSeriesDetailCache };
