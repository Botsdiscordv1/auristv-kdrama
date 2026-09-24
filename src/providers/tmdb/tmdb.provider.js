const { MetadataProvider } = require('../base/MetadataProvider');
const { getKey } = require('../../../utils/tmdb-key');
const mappers = require('./tmdb.mapper');

const SEASON_CLEAN_RE = /\s*[-–\s]*(?:\d+(?:st|nd|rd|th)?\s*(?:season|temporada|part|parte)|(?:season|temporada|part|parte)\s*\d+|II{1,3}|IV|V|VI{1,3}|final\s*season)\s*$/i;
const ONE_DAY = 86400000;

class TMDBProvider extends MetadataProvider {
  constructor() {
    super('TMDB', 'https://api.themoviedb.org/3', {
      timeout: 6000,
      cacheTTL: ONE_DAY,
    });
  }

  async initialize() {
    await super.initialize();
    const key = getKey();
    if (!key) throw new Error('TMDB API key not configured');
    this.client.interceptors.request.use(config => {
      config.params = { ...config.params, api_key: key };
      return config;
    });
  }

  async searchTV(query, language = 'en-US') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get('/search/tv', { params: { query, language, include_adult: false } });
        return mappers.toAnimeSummaryList(data.results);
      },
      ['searchTV', query, language],
      ONE_DAY
    );
  }

  async searchMulti(query, language = 'es-MX') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get('/search/multi', { params: { query, language, include_adult: false } });
        return mappers.toAnimeSummaryList(data.results);
      },
      ['searchMulti', query, language],
      ONE_DAY
    );
  }

  async searchMovie(query) {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get('/search/movie', { params: { query, include_adult: false } });
        return mappers.toAnimeSummaryList(data.results);
      },
      ['searchMovie', query],
      ONE_DAY
    );
  }

  async getTVDetail(id, language = 'en-US') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/tv/${id}`, {
          params: { language, append_to_response: 'content_ratings,videos' },
        });
        return mappers.toDetail(data, data);
      },
      ['getTVDetail', String(id), language],
      ONE_DAY
    );
  }

  async getMovieDetail(id, language = 'en-US') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/movie/${id}`, {
          params: { language, append_to_response: 'release_dates,videos' },
        });
        return mappers.toDetail(data, data);
      },
      ['getMovieDetail', String(id), language],
      ONE_DAY
    );
  }

  async findTV(query, language = 'en-US') {
    const queriesToTry = [query];
    const cleanQ = query.replace(SEASON_CLEAN_RE, '').trim();
    if (cleanQ && cleanQ !== query) queriesToTry.push(cleanQ);

    for (const q of queriesToTry) {
      try {
        const result = await this._executeRequest(
          async () => {
            const { data } = await this.client.get('/search/tv', { params: { query: q, language, include_adult: false } });
            const results = data.results || [];
            if (!results.length) return null;
            const best = results[0];
            return {
              id: best.id,
              name: best.name,
              originalName: best.original_name,
              totalSeasons: best.number_of_seasons || 1,
            };
          },
          ['findTV', q, language],
          ONE_DAY
        );
        if (result) return result;
      } catch { continue; }
    }
    return null;
  }

  async getSeason(tvId, seasonNumber, language = 'en-US') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/tv/${tvId}/season/${seasonNumber}`, { params: { language } });
        return { episodes: mappers.toEpisodeList(data.episodes), raw: data };
      },
      ['getSeason', String(tvId), String(seasonNumber), language],
      ONE_DAY
    );
  }

  async getSeasonImages(tvId, seasonNumber) {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/tv/${tvId}/season/${seasonNumber}/images`);
        const bd = data?.backdrops?.[0]?.file_path;
        return bd ? `https://image.tmdb.org/t/p/original${bd}` : null;
      },
      ['getSeasonImages', String(tvId), String(seasonNumber)],
      ONE_DAY
    );
  }

  async getSeasonLocalized(tvId, seasonNumber) {
    const [mx, es, en] = await Promise.all([
      this.getSeason(tvId, seasonNumber, 'es-MX').catch(() => null),
      this.getSeason(tvId, seasonNumber, 'es-ES').catch(() => null),
      this.getSeason(tvId, seasonNumber, 'en-US').catch(() => null),
    ]);
    return { mxEpisodes: mx?.episodes || [], esEpisodes: es?.episodes || [], enEpisodes: en?.episodes || [] };
  }

  async getTrendingMovies(language = 'es-MX') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get('/trending/movie/week', { params: { language } });
        let filtered = (data.results || [])
          .filter(r => r.original_language === 'ja' && (r.genre_ids || []).includes(16));

        // Complementar con discovery si hay pocos resultados
        if (filtered.length < 10) {
          const discover = await this._executeRequest(
            async () => {
              const { data: d } = await this.client.get('/discover/movie', {
                params: { language, sort_by: 'popularity.desc', with_genres: '16', with_original_language: 'ja', 'vote_count.gte': 50, include_adult: false }
              });
              return d.results || [];
            },
            ['getDiscoverAnimeMovies', language],
            86400000
          );
          const existingIds = new Set(filtered.map(r => r.id));
          for (const item of discover) {
            if (!existingIds.has(item.id)) {
              filtered.push(item);
              existingIds.add(item.id);
            }
          }
        }

        return filtered.map(r => ({
          ...mappers.toAnimeSummary(r),
          originalIndex: 0,
        }));
      },
      ['getTrendingMovies', language],
      3600000
    );
  }

  async getTrending(language = 'es-MX') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get('/trending/tv/week', { params: { language } });
        let filtered = (data.results || [])
          .filter(r => r.original_language === 'ja' && (r.genre_ids || []).includes(16));

        // Si hay muy pocos resultados en trending, complementamos con discovery global
        if (filtered.length < 10) {
          const discover = await this.getDiscoverAnime(language);
          // Mezclamos y quitamos duplicados por ID
          const existingIds = new Set(filtered.map(r => r.id));
          for (const item of discover) {
            if (!existingIds.has(item.id)) {
              filtered.push(item);
              existingIds.add(item.id);
            }
          }
        }

        let idx = 0;
        return filtered.map(r => ({
          ...mappers.toAnimeSummary(r),
          originalIndex: idx++,
        }));
      },
      ['getTrending', language],
      3600000
    );
  }

  async getDiscoverAnime(language = 'es-MX') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get('/discover/tv', {
          params: {
            language,
            sort_by: 'popularity.desc',
            with_genres: '16',
            with_original_language: 'ja',
            'vote_count.gte': 50,
            include_adult: false,
          }
        });
        return data.results || [];
      },
      ['getDiscoverAnime', language],
      ONE_DAY
    );
  }

  async searchBest(query, language = 'es-MX') {
    const queriesToTry = [query];
    const cleanQ = query.replace(SEASON_CLEAN_RE, '').trim();
    if (cleanQ && cleanQ !== query) queriesToTry.push(cleanQ);

    for (const q of queriesToTry) {
      try {
        const result = await this._executeRequest(
          async () => {
            const { data } = await this.client.get('/search/multi', { params: { query: q, language, include_adult: false } });
            const results = data.results || [];
            if (!results.length) return null;
            const best = results[0];
            return {
              id: best.id,
              mediaType: best.media_type,
              poster: best.poster_path ? `https://image.tmdb.org/t/p/w500${best.poster_path}` : null,
              banner: best.backdrop_path ? `https://image.tmdb.org/t/p/original${best.backdrop_path}` : null,
              title: best.name || best.title,
              overview: best.overview || null,
            };
          },
          ['searchBest', q, language],
          ONE_DAY
        );
        if (result) return result;
      } catch { continue; }
    }
    return null;
  }
}

module.exports = { TMDBProvider };