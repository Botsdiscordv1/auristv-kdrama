const { ScheduleResolver } = require('../resolvers/ScheduleResolver');
const { VisualResolver } = require('../resolvers/VisualResolver');
const { AvailabilityService } = require('../services/AvailabilityService');


const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const ENRICH_TIMEOUT = 14000;
const TMDB_MAX = 10;
const TMDB_CONCURRENCY = 5;

const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();

class ScheduleAggregator {
  constructor() {
    const { AnimeScheduleProvider } = require('../providers/animeSchedule/animeSchedule.provider');
    const { TMDBProvider } = require('../providers/tmdb/tmdb.provider');

    const schedule = new AnimeScheduleProvider();
    const tmdb = new TMDBProvider();

    this.scheduleResolver = new ScheduleResolver(schedule);
    this.visualResolver = new VisualResolver(tmdb);
  }

  async getSchedule() {
    const start = Date.now();
    this._log('ScheduleAggregator', 'start');

    const cacheKey = 'schedule:sub';
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      this._log('ScheduleAggregator', 'cache_hit');
      return cached.data;
    }

    const timetables = await this._resolve();

    if (!timetables || timetables.length === 0) {
      const empty = this._buildEmptyDTO();
      cache.set(cacheKey, { data: empty, timestamp: Date.now() });
      return empty;
    }

    const unique = this._dedupByRoute(timetables);
    const dayItems = await this._distributeByDay(unique);

    await this._enrich(dayItems);

    const dto = this._buildDTO(dayItems);

    cache.set(cacheKey, { data: dto, timestamp: Date.now() });

    // Invalidar cache después de que AvailabilityService procese los items en background
    // El queue tiene throttle de 2s entre items + tiempo de scraping
    const totalItems = dayItems.flat().length;
    if (totalItems > 0) {
      const delay = Math.min(totalItems * 3000 + 5000, 5 * 60 * 1000);
      setTimeout(() => {
        cache.delete(cacheKey);
        this._log('ScheduleAggregator', 'cache_invalidated_for_refresh', { items: totalItems, delayMs: delay });
      }, delay);
    }

    const duration = Date.now() - start;
    this._log('ScheduleAggregator', 'end', { duration });

    return dto;
  }

  async _resolve() {
    try {
      return await this.scheduleResolver.resolve('sub');
    } catch (err) {
      this._log('ScheduleAggregator', 'ScheduleResolver error', err.message);
      return [];
    }
  }

  _dedupByRoute(entries) {
    const map = new Map();
    for (const e of entries) {
      const existing = map.get(e.route);
      if (!existing || e.episodeNumber > existing.episodeNumber) {
        map.set(e.route, e);
      }
    }
    return [...map.values()];
  }

  async _distributeByDay(entries) {
    const days = Array.from({ length: 7 }, () => []);

    await Promise.all(entries.map(async (entry) => {
      const epDate = new Date(entry.episodeDate);
      if (isNaN(epDate.getTime())) return;
      const dayIdx = (epDate.getDay() + 6) % 7;
      const title = entry.romaji || entry.english || entry.title;
      if (!title) return;

      const sourceAvailable = await AvailabilityService.checkAvailability({
        id: entry.route || entry.id || `schedule-${title}`,
        title: entry.romaji || entry.english || entry.title,
        romaji: entry.romaji,
        english: entry.english,
        year: entry.year || (entry.episodeDate ? new Date(entry.episodeDate).getFullYear() : null),
      });

      days[dayIdx].push({
        id: entry.id || 0,
        title,
        epDate,
        romaji: entry.romaji || entry.title || null,
        english: entry.english || null,
        native: entry.native || null,
        description: null,
        coverImage: entry.imageVersionRoute
          ? `https://img.animeschedule.net/production/assets/public/img/${entry.imageVersionRoute}`
          : null,
        genres: [],
        studio: null,
        nextEpisode: entry.episodeNumber ?? null,
        airingAt: Math.floor(epDate.getTime() / 1000),
        episode: entry.episodeNumber || 0,
        airDate: entry.episodeDate,
        aired: entry.airingStatus === 'aired' || epDate < new Date(),
        sourceAvailable,
        dayIndex: dayIdx,
        year: entry.year || (entry.airingAt ? new Date(entry.airingAt * 1000).getFullYear() : null),
        format: entry.format || null,
      });
    }));

    return days;
  }

  async _enrich(dayItems) {
    const enrichable = dayItems.flat();

    await Promise.race([
      this._runEnrichment(enrichable),
      new Promise(r => setTimeout(() => r(), ENRICH_TIMEOUT)),
    ]);
  }

  async _runEnrichment(items) {
    let tmdbCount = 0;

    for (let i = 0; i < items.length && tmdbCount < TMDB_MAX; i += TMDB_CONCURRENCY) {
      const batch = items.slice(i, i + TMDB_CONCURRENCY);
      await Promise.all(batch.map(async (item) => {
        if (tmdbCount >= TMDB_MAX) return;
        tmdbCount++;
        const result = await this.visualResolver.searchTMDB(item.title);
        if (!result) return;
        if (!item.description && result.overview) item.description = result.overview;
        item.coverImage = result.poster || item.coverImage;
        item.genres = result.genres || [];
      }));
    }
  }

  _buildDTO(dayItems) {
    const todayIdx = (new Date().getDay() + 6) % 7;
    const days = dayItems.map((list, i) => {
      const items = list
        .filter(it => it.title)
        .sort((a, b) => (a.airingAt || 0) - (b.airingAt || 0))
        .map(it => ({
          id: it.id || 0,
          title: it.title || '',
          romaji: it.romaji || null,
          english: it.english || null,
          native: it.native || null,
          synonyms: [],
          description: null,
          coverImage: it.coverImage || null,
          genres: it.genres || [],
          studio: null,
          episodes: null,
          format: it.format || null,
          status: null,
          averageScore: null,
          nextEpisode: it.nextEpisode ?? null,
          airingAt: it.airingAt ?? null,
          episode: it.episode || 0,
          aired: !!it.aired,
          sourceAvailable: !!it.sourceAvailable,
          year: it.year || (it.airingAt ? new Date(it.airingAt * 1000).getFullYear() : null),
        }));

      return { day: WEEKDAY_NAMES[i], dayIndex: i, items };
    });

    return {
      days,
      todayIndex: todayIdx,
    };
  }

  _buildEmptyDTO() {
    const todayIdx = (new Date().getDay() + 6) % 7;
    return {
      days: Array.from({ length: 7 }, (_, i) => ({
        day: WEEKDAY_NAMES[i], items: [],
      })),
      todayIndex: todayIdx,
    };
  }

  _getCurrentSeason() {
    const m = new Date().getMonth() + 1;
    if (m <= 3) return 'WINTER';
    if (m <= 6) return 'SPRING';
    if (m <= 9) return 'SUMMER';
    return 'FALL';
  }

  _log(aggregator, event, data) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${aggregator}] ${event}${data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''}`);
    }
  }
}

module.exports = { ScheduleAggregator };
