const axios = require("axios");
const { getTMDBKey } = require("../utils/config");
const { fetchTimetables, buildImageUrl } = require("../utils/animeschedule");

const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const HORARIO_SOURCES = [
  { name: "AnimeAV1", url: "https://animeav1.com/horario", priority: 1 },
  { name: "JKAnime", url: "https://jkanime.net/horario/", priority: 2 },
];

const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

const GENRE_MAP = {
  16: 'Animation', 28: 'Action', 12: 'Adventure', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};

function getDayFromISODate(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return -1;
  return (d.getDay() + 6) % 7;
}

async function fetchHorarioEntries() {
  const entriesByKey = new Map();
  for (const source of HORARIO_SOURCES) {
    try {
      const { data } = await axios.get(source.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html" },
        timeout: 10000,
      });
      let searchIdx = 0;
      while (true) {
        const start = data.indexOf('{id:', searchIdx);
        if (start === -1) break;
        let depth = 0, end = start;
        for (let i = start; i < data.length; i++) {
          if (data[i] === '{') depth++;
          else if (data[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end === start) break;
        const entry = data.substring(start, end);
        searchIdx = end;
        const titleM = entry.match(/title:"([^"]*)"/);
        const epM = entry.match(/latestEpisode:\{id:\d+,number:(\d+)/);
        const createdAtM = entry.match(/latestEpisode:\{id:\d+,number:\d+,createdAt:"([^"]+)"/);
        if (!titleM || !epM) continue;
        const idM = entry.match(/\{id:(\d+),/);
        const title = titleM[1].trim();
        const latestEp = parseInt(epM[1], 10);
        const createdAt = createdAtM ? createdAtM[1] : null;
        const horarioId = idM ? parseInt(idM[1], 10) : 0;
        if (!title || isNaN(latestEp)) continue;
        const dayIdx = createdAt ? getDayFromISODate(createdAt) : -1;
        const key = normalize(title);
        if (!entriesByKey.has(key) || source.priority === 1) {
          entriesByKey.set(key, { id: horarioId, title, latestEp, createdAt, dayIdx, source: source.name });
        }
      }
    } catch (e) {
      console.warn(`[Schedule] Horario fetch failed for ${source.name}: ${e.message}`);
    }
  }
  return entriesByKey;
}

function getCurrentSeason() {
  const m = new Date().getMonth() + 1;
  if (m <= 3) return "WINTER";
  if (m <= 6) return "SPRING";
  if (m <= 9) return "SUMMER";
  return "FALL";
}

let scheduleCache = null;
let scheduleCacheTime = 0;
let scheduleBuildPromise = null;
const CACHE_TTL = 60 * 60 * 1000;

async function getSchedule() {
  const now = Math.floor(Date.now() / 1000);
  const todayIdx = (new Date().getDay() + 6) % 7;

  if (scheduleCache && (Date.now() - scheduleCacheTime) < CACHE_TTL) {
    scheduleCache.days.forEach(d => d.isToday = d.dayIndex === todayIdx);
    return scheduleCache;
  }
  if (scheduleBuildPromise) {
    if (scheduleCache) {
      scheduleCache.days.forEach(d => d.isToday = d.dayIndex === todayIdx);
      return scheduleCache;
    }
    return scheduleBuildPromise;
  }

  scheduleBuildPromise = (async () => {
    try {

  const [horarioMap, timetableRaw] = await Promise.all([
    fetchHorarioEntries().catch(() => new Map()),
    fetchTimetables('sub').catch(() => null),
  ]);

  if (!timetableRaw?.length && scheduleCache) {
    scheduleCache.days.forEach(d => d.isToday = d.dayIndex === todayIdx);
    return scheduleCache;
  }
  if (!timetableRaw?.length) {
    console.warn('[Schedule] AnimeSchedule returned no data, returning empty schedule');
    const empty = { season: getCurrentSeason(), year: new Date().getFullYear(), total: 0, days: Array.from({ length: 7 }, (_, i) => ({ day: WEEKDAY_NAMES[i], dayIndex: i, isToday: i === todayIdx, items: [] })) };
    scheduleCache = empty;
    scheduleCacheTime = Date.now();
    return empty;
  }

  // Deduplicate by route (keep latest episode)
  const animeByRoute = new Map();
  for (const entry of timetableRaw) {
    const route = entry.route;
    const existing = animeByRoute.get(route);
    if (!existing || entry.episodeNumber > existing.episodeNumber) {
      animeByRoute.set(route, entry);
    }
  }
  const timetables = [...animeByRoute.values()];
  console.log(`[Schedule] AnimeSchedule: ${timetableRaw.length} entries → ${timetables.length} unique anime`);

  // Build day items from AnimeSchedule (primary)
  const dayItems = Array.from({ length: 7 }, () => []);
  for (const entry of timetables) {
    const epDate = new Date(entry.episodeDate);
    if (isNaN(epDate.getTime())) continue;
    const dayIdx = (epDate.getDay() + 6) % 7;
    dayItems[dayIdx].push({ _source: "animeschedule", entry, epDate });
  }

  // Count remaining horario-only entries for fallback enrichment
  let horarioFallbackCount = 0;
  for (const [, horario] of horarioMap) {
    const matched = timetables.some(e => {
      const t = e.romaji || e.english || e.title;
      return t && normalize(t) === normalize(horario.title);
    });
    if (!matched) horarioFallbackCount++;
  }
  if (horarioFallbackCount) {
    console.log(`[Schedule] ${horarioFallbackCount} horario-only entries (no AnimeSchedule match)`);
  }

  const ENRICH_TIMEOUT = 14000; // max 14s for enrichment
  let tmdbCount = 0;

  // Build base items first (always fast)
  const todayDate = new Date();
  const enrichableItems = [];
  for (let day = 0; day < dayItems.length; day++) {
    for (const item of dayItems[day]) {
      if (item._source !== 'animeschedule') continue;
      const entry = item.entry;
      const title = entry.english || entry.romaji || entry.title;
      if (!title) continue;
      const epDate = item.epDate;
      item._title = title;
      item.romaji = entry.romaji || entry.title || null;
      item.english = entry.english || null;
      item.native = entry.native || null;
      item.coverImage = buildImageUrl(entry.imageVersionRoute);
      item.nextEpisode = entry.episodeNumber != null ? entry.episodeNumber : null;
      item.airingAt = Math.floor(epDate.getTime() / 1000);
      item.episode = entry.episodeNumber || 0;
      item.aired = entry.airingStatus === 'aired' || epDate < todayDate;
      item.sourceAvailable = true;
      enrichableItems.push(item);
    }
  }

  // Enrichment with timeout
  await Promise.race([
    (async () => {
      // Parallel TMDB enrichment (concurrency 5, max 10 items)
      const TMDB_MAX = 10;
      if (getTMDBKey()) {
        const tmdbSearch = async (item) => {
          if (tmdbCount >= TMDB_MAX) return;
          tmdbCount++;
          try {
            const resp = await axios.get('https://api.themoviedb.org/3/search/multi', {
              params: { api_key: getTMDBKey(), query: item._title.replace(/:\s*/g, ' ').trim(), language: 'es-MX' },
              timeout: 5000,
            });
            const best = resp.data?.results?.[0];
            if (!best) return;
            if (!item.description && best.overview) {
              item.description = best.overview.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
            }
            if (!item.genres?.length && best.genre_ids?.length) {
              item.genres = best.genre_ids.map(id => GENRE_MAP[id] || null).filter(Boolean);
            }
            if (best.poster_path || best.backdrop_path) {
              item.coverImage = `https://image.tmdb.org/t/p/w500${best.poster_path || best.backdrop_path}`;
            }
            if (!item.status) {
              if (best.status === 'Returning Series' || best.status === 'In Production') item.status = 'RELEASING';
              else if (best.status === 'Ended' || best.status === 'Canceled') item.status = 'FINISHED';
              else item.status = 'RELEASING';
            }
            if (!item.studio && best.production_companies?.length) item.studio = best.production_companies[0].name;
            if (!item.episodes && best.number_of_episodes) item.episodes = best.number_of_episodes;
            if (!item.averageScore && best.vote_average) item.averageScore = Math.round(best.vote_average * 10) / 10;
          } catch (_) {}
        };

        for (let i = 0; i < Math.min(TMDB_MAX, enrichableItems.length); i += 5) {
          await Promise.all(enrichableItems.slice(i, i + 5).map(item => tmdbSearch(item)));
        }
      }

    })(),
    new Promise(r => setTimeout(() => { console.warn('[Schedule] Enrichment timed out, returning basic data'); r(); }, ENRICH_TIMEOUT)),
  ]);

  // Build response days
  const days = dayItems.map((list, i) => {
    const items = list
      .filter(it => it._title)
      .map(it => ({
        id: it.id || 0,
        title: it._title,
        romaji: it.romaji || null,
        english: it.english || null,
        native: it.native || null,
        synonyms: it.synonyms || [],
        description: it.description || '',
        coverImage: it.coverImage || null,
        genres: it.genres || [],
        studio: it.studio || null,
        episodes: it.episodes || null,
        format: it.format || 'TV',
        status: it.status || 'RELEASING',
        averageScore: it.averageScore || null,
        nextEpisode: it.nextEpisode,
        airingAt: it.airingAt || null,
        episode: it.episode,
        aired: it.aired,
        sourceAvailable: it.sourceAvailable,
        startDate: null,
      }))
      .sort((a, b) => (a.airingAt || 0) - (b.airingAt || 0));

    return { day: WEEKDAY_NAMES[i], dayIndex: i, items };
  });

  const total = days.reduce((s, d) => s + d.items.length, 0);

  const result = {
    season: getCurrentSeason(),
    year: new Date().getFullYear(),
    total,
    days: days.map(d => ({ ...d, isToday: d.dayIndex === todayIdx })),
  };
  scheduleCache = result;
  scheduleCacheTime = Date.now();
  return result;
    } finally {
      scheduleBuildPromise = null;
    }
  })();

  return scheduleBuildPromise;
}

// Pre-warm cache on startup (non-blocking)
setTimeout(() => {
  getSchedule().then(() => console.log('[Schedule] Cache pre-warmed')).catch(() => {});
}, 3000);

module.exports = {
  fetchAiringThisWeek: async () => {
    const data = await fetchTimetables('sub').catch(() => []);
    const byRoute = new Map();
    for (const e of data) {
      if (!byRoute.has(e.route) || e.episodeNumber > byRoute.get(e.route).episodeNumber) {
        byRoute.set(e.route, e);
      }
    }
    return [...byRoute.values()];
  },
  getSchedule,
  getCurrentSeason,
};
