const { IdentityResolver } = require('../resolvers/IdentityResolver');
const { VisualResolver } = require('../resolvers/VisualResolver');
const { EpisodeResolver } = require('../resolvers/EpisodeResolver');
const { ThemeResolver } = require('../resolvers/ThemeResolver');
const { PlayerAssembler } = require('../assemblers/PlayerAssembler');

const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();

class PlayerAggregator {
  constructor() {
    const { AniListProvider } = require('../providers/anilist/anilist.provider');
    const { TMDBProvider } = require('../providers/tmdb/tmdb.provider');
    const { AnimeThemesProvider } = require('../providers/animeThemes/animeThemes.provider');

    const anilist = new AniListProvider();
    const tmdb = new TMDBProvider();
    const themes = new AnimeThemesProvider();

    this.identityResolver = new IdentityResolver(anilist);
    this.visualResolver = new VisualResolver(tmdb);
    this.episodeResolver = new EpisodeResolver(tmdb);
    this.themeResolver = new ThemeResolver(themes);

    this.assembler = new PlayerAssembler();
  }

  async getPlayerInfo({ title, malId, tmdbId, episodeNumber, seasonNumber, language = 'es-MX' }) {
    const start = Date.now();
    const searchTitle = title || '';
    this._log('PlayerAggregator', 'PlayerOpened', { searchTitle, episodeNumber });

    this._validate({ searchTitle, episodeNumber });

    const cacheKey = `player:${searchTitle}:${episodeNumber}:${language}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      this._log('PlayerAggregator', 'PlayerCacheHit', { cacheKey });
      return cached.data;
    }
    this._log('PlayerAggregator', 'PlayerCacheMiss', { cacheKey });

    const identityData = await this._resolveIdentity(searchTitle, malId);
    if (!identityData) {
      this._log('PlayerAggregator', 'PlayerFailed', 'Identity not found');
      return null;
    }

    const resolved = await this._resolveAll(identityData, { tmdbId, seasonNumber, episodeNumber, language });

    const dto = this.assembler.assemble({
      identity: resolved.identity,
      visual: resolved.visual,
      episode: resolved.episode,
      themes: resolved.themes,
      episodeNumber,
      servers: [],
    });

    cache.set(cacheKey, { data: dto, timestamp: Date.now() });

    const duration = Date.now() - start;
    this._log('PlayerAggregator', 'PlayerLoaded', { duration });

    return dto;
  }

  _validate({ searchTitle, episodeNumber }) {
    if (!searchTitle) throw new Error('title is required');
    if (!episodeNumber) throw new Error('episodeNumber is required');
  }

  async _resolveIdentity(searchTitle, malId) {
    try {
      return await this.identityResolver.resolve(searchTitle, malId);
    } catch (err) {
      this._log('PlayerAggregator', 'IdentityResolver error', err.message);
      return null;
    }
  }

  async _resolveAll(identity, { tmdbId, seasonNumber, episodeNumber, language }) {
    const finalTmdbId = tmdbId || identity?.tmdbId || null;
    const finalMalId = identity?.malId || null;
    const finalSeasonNumber = seasonNumber || identity?.seasonNumber || 1;

    const [visualResult, episodeResult, themeResult] = await Promise.allSettled([
      this._resolveVisual(identity, finalTmdbId, language),
      this._resolveEpisode(finalTmdbId, finalSeasonNumber, episodeNumber, language),
      this._resolveThemes(identity, finalMalId),
    ]);

    return {
      identity,
      visual: this._extractFulfilled(visualResult),
      episode: this._extractFulfilled(episodeResult),
      themes: this._extractFulfilled(themeResult, []),
    };
  }

  async _resolveVisual(identity, tmdbId, language) {
    if (!tmdbId) return null;
    try {
      return await this.visualResolver.getTVDetail(tmdbId, language);
    } catch {
      return null;
    }
  }

  async _resolveEpisode(tmdbId, seasonNumber, episodeNumber, language) {
    if (!tmdbId || !seasonNumber) return null;
    try {
      const season = await this.episodeResolver.resolve(tmdbId, seasonNumber, language);
      if (season?.episodes) {
        return season.episodes.find(ep => ep.episodeNumber === episodeNumber) || null;
      }
      return null;
    } catch {
      return null;
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

  _log(aggregator, event, data) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${aggregator}] ${event}${data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''}`);
    }
  }
}

module.exports = { PlayerAggregator };