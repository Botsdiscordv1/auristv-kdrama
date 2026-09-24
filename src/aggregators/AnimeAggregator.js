const { IdentityResolver } = require('../resolvers/IdentityResolver');
const { VisualResolver } = require('../resolvers/VisualResolver');
const { ThemeResolver } = require('../resolvers/ThemeResolver');
const { CharacterResolver } = require('../resolvers/CharacterResolver');
const { EpisodeResolver } = require('../resolvers/EpisodeResolver');
const { ScheduleResolver } = require('../resolvers/ScheduleResolver');
const { AnimeDetailAssembler } = require('../assemblers/AnimeDetailAssembler');
const { AvailabilityService } = require('../services/AvailabilityService');

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

class AnimeAggregator {
  constructor() {
    const { AniListProvider, getCurrentSeason } = require('../providers/anilist/anilist.provider');
    const { TMDBProvider } = require('../providers/tmdb/tmdb.provider');
    const { AnimeThemesProvider } = require('../providers/animeThemes/animeThemes.provider');
    const { JikanProvider } = require('../providers/jikan/jikan.provider');
    const { AnimeScheduleProvider } = require('../providers/animeSchedule/animeSchedule.provider');

    const anilist = new AniListProvider();
    const tmdb = new TMDBProvider();
    const themes = new AnimeThemesProvider();
    const jikan = new JikanProvider();
    const schedule = new AnimeScheduleProvider();

    this.identityResolver = new IdentityResolver(anilist);
    this.visualResolver = new VisualResolver(tmdb);
    this.themeResolver = new ThemeResolver(themes);
    this.characterResolver = new CharacterResolver(jikan, anilist);
    this.episodeResolver = new EpisodeResolver(tmdb);
    this.scheduleResolver = new ScheduleResolver(schedule);

    this.assembler = new AnimeDetailAssembler();
  }

  async getDetail(title, malId = null, metadataTitle = null, year = null) {
    const start = Date.now();
    const searchTitle = title || metadataTitle || '';
    this._log('AnimeDetailAggregator', 'AnimeDetailStarted', { searchTitle, year });

    this._validate({ searchTitle });

    const cacheKey = `anime:${searchTitle}:${malId}:${year}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      this._log('AnimeDetailAggregator', 'AnimeDetailCacheHit', { cacheKey });
      return cached.data;
    }
    this._log('AnimeDetailAggregator', 'AnimeDetailCacheMiss', { cacheKey });

    const identityData = await this._resolveIdentity(searchTitle, malId, metadataTitle, year);
    if (!identityData) {
      this._log('AnimeDetailAggregator', 'AnimeDetailFailed', 'Identity not found');
      return null;
    }

    const resolved = await this._resolveAll(identityData, searchTitle);

    const merged = this.assembler.assemble({
      identity: resolved.identity,
      visual: resolved.visual,
      episodes: resolved.episodes,
      characters: resolved.characters,
      schedule: resolved.schedule,
      themes: resolved.themes,
      searchTitle,
    });

    const normalized = this._normalize(merged);

    const dto = await this.assembler.buildDTO(normalized);

    if (this._isAdultContent(dto)) {
      this._log('AnimeDetailAggregator', 'BlockedAdultContent', { searchTitle });
      return null;
    }

    cache.set(cacheKey, { data: dto, timestamp: Date.now() });

    const duration = Date.now() - start;
    this._log('AnimeDetailAggregator', 'AnimeDetailCompleted', { duration });

    return dto;
  }

  async search(query) {
    const [anilistResults, tmdbResults] = await Promise.allSettled([
      this.identityResolver.search(query),
      this.visualResolver.searchTV(query),
    ]);

    const summaries = [];
    for (const r of [anilistResults, tmdbResults]) {
      if (r.status === 'fulfilled' && r.value?.length) {
        summaries.push(...r.value.filter(item => !this._isAdultContent(item)));
      }
    }

    // Filtrar por disponibilidad (asíncrono, usa caché)
    const available = [];
    for (const item of summaries) {
      if (await AvailabilityService.checkAvailability(item)) {
        available.push(item);
      }
    }

    return available;
  }

  async getTrending(type = 'trending') {
    const season = this.identityResolver.getCurrentSeason();
    const year = new Date().getFullYear();

    if (type === 'seasonal') {
      // Prioridad absoluta a AniList para temporada actual
      try {
        const results = await this.identityResolver.getTrending(season, year);
        if (results && results.length > 10) return results;
      } catch (err) {
        this._log('AnimeDetailAggregator', 'Seasonal fetch failed', err.message);
      }
    }

    // Para tendencia global o si falla lo anterior, probamos ambas y mezclamos o priorizamos
    const results = await Promise.allSettled([
      this.identityResolver.getTrending(season, year),
      this.visualResolver.getTrending(),
    ]);

    const aniListRes = results[0].status === 'fulfilled' ? results[0].value : [];
    const tmdbRes = results[1].status === 'fulfilled' ? results[1].value : [];

    let finalResults = [];
    if (type === 'trending') {
      finalResults = (tmdbRes.length > 0 ? tmdbRes : aniListRes).filter(item => !this._isAdultContent(item));
    } else {
      finalResults = (aniListRes.length > 0 ? aniListRes : tmdbRes).filter(item => !this._isAdultContent(item));
    }

    // Filtrado por disponibilidad
    const filtered = [];
    for (const item of finalResults) {
      if (await AvailabilityService.checkAvailability(item)) {
        filtered.push(item);
      }
    }

    return filtered;
  }

  async getTrendingMovies() {
    try {
      // Primero AniList (trending movies)
      let results = await this.identityResolver.getTrendingMovies();
      if (!results || results.length === 0) {
        // Fallback: TMDB movie trending
        this._log('AnimeAggregator', 'AniList movies empty, trying TMDB...');
        const tmdbResults = await this.visualResolver.getTrendingMovies();
        results = tmdbResults || [];
      }

      const filtered = results.filter(item => !this._isAdultContent(item));

      // Filtrado por disponibilidad (asíncrono, usa caché alimentada por warm-up)
      const available = [];
      for (const item of filtered) {
        if (await AvailabilityService.checkAvailability(item)) {
          available.push(item);
        }
      }

      // Enriquecer con banners via TMDB
      for (const item of available) {
        const searchTitle = item.romaji || item.english || item.title;
        if (searchTitle && !item.banner) {
          try {
            const visual = await this.visualResolver.searchTMDB(searchTitle);
            if (visual?.banner) item.banner = visual.banner;
          } catch {}
        }
      }

      return available;
    } catch (err) {
      this._log('AnimeAggregator', 'getTrendingMovies failed', err.message);
      return [];
    }
  }

  _isAdultContent(item) {
    if (!item) return false;
    const title = (item.title || item.name || '').toLowerCase();
    const genres = (item.genres || []).map(g => (typeof g === 'string' ? g : '').toLowerCase());

    // Blacklist estricta de títulos y palabras clave
    const adultKeywords = [
      'hentai', 'uncensored', 'explicit content', 'sex', 'xxx', 'erotica',
      'overflow', 'motto overflow', 'boku no pico', 'yosuga no sora', 'euphoria anime'
    ];

    const hasAdultKeyword = adultKeywords.some(kw => {
      // Verificación de palabra completa para evitar falsos positivos (ej: "sex" vs "six")
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(title);
    });

    const hasAdultGenre = genres.some(g =>
      g.includes('hentai') || g.includes('adult') || g.includes('erotica') || g.includes('h-anime')
    );

    return hasAdultKeyword || hasAdultGenre || item.isAdult === true;
  }

  _validate({ searchTitle }) {
    if (!searchTitle || typeof searchTitle !== 'string') {
      throw new Error('searchTitle is required');
    }
  }

  async _resolveIdentity(searchTitle, malId, metadataTitle, year) {
    try {
      return await this.identityResolver.resolve(searchTitle, malId, metadataTitle, year);
    } catch (err) {
      this._log('AnimeDetailAggregator', 'IdentityResolver error', err.message);
      return null;
    }
  }

  async _resolveAll(identity, searchTitle) {
    const malId = identity?.malId || null;
    const tmdbId = identity?.tmdbId || null;
    const seasonNumber = identity?.seasonNumber || null;

    const [visualResult, episodeResult, characterResult, scheduleResult, themeResult] = await Promise.allSettled([
      this._resolveVisual(identity, searchTitle),
      this._resolveEpisodes(tmdbId, seasonNumber),
      this._resolveCharacters(malId),
      this._resolveSchedule(),
      this._resolveThemes(identity, malId),
    ]);

    return {
      identity,
      visual: this._extractFulfilled(visualResult),
      episodes: this._extractFulfilled(episodeResult),
      characters: this._extractFulfilled(characterResult, []),
      schedule: this._extractFulfilled(scheduleResult, {}),
      themes: this._extractFulfilled(themeResult, []),
    };
  }

  async _resolveVisual(identity, searchTitle) {
    try {
      const tmdbId = identity?.tmdbId || (await this.visualResolver.findTV(searchTitle, 'es-MX'))?.id || null;
      if (tmdbId) {
        return await this.visualResolver.getTVDetail(tmdbId, 'es-MX');
      }
      return null;
    } catch {
      return null;
    }
  }

  async _resolveEpisodes(tmdbId, seasonNumber) {
    if (!tmdbId || !seasonNumber) return null;
    try {
      return await this.episodeResolver.resolve(tmdbId, seasonNumber, 'es-MX');
    } catch {
      return null;
    }
  }

  async _resolveCharacters(malId) {
    if (!malId) return [];
    try {
      return await this.characterResolver.resolve(malId);
    } catch {
      return [];
    }
  }

  async _resolveSchedule() {
    try {
      return await this.scheduleResolver.resolve('sub');
    } catch {
      return {};
    }
  }

  async _resolveThemes(identity, malId) {
    if (!malId) return [];
    try {
      return await this.themeResolver.resolve(identity, malId);
    } catch {
      return [];
    }
  }

  _extractFulfilled(result, defaultValue = null) {
    return result?.status === 'fulfilled' ? (result.value ?? defaultValue) : defaultValue;
  }

  _normalize(detail) {
    if (!detail.genres || detail.genres.length === 0) {
      detail.genres = [];
    }
    if (!detail.synonyms || detail.synonyms.length === 0) {
      detail.synonyms = [];
    }
    if (detail.episodes === 0 || detail.episodes === undefined) {
      detail.episodes = null;
    }
    return detail;
  }

  _log(aggregator, event, data) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${aggregator}] ${event}${data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''}`);
    }
  }
}

module.exports = { AnimeAggregator };
