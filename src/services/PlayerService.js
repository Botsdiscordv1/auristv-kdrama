const { TMDBProvider } = require('../providers/tmdb/tmdb.provider');
const { EpisodeResolver } = require('../resolvers/EpisodeResolver');

class PlayerService {
  constructor() {
    const tmdb = new TMDBProvider();
    this.episodeResolver = new EpisodeResolver(tmdb);
  }

  async getEpisodeMetadata(tmdbId, seasonNumber, language = 'es-MX') {
    return this.episodeResolver.resolve(tmdbId, seasonNumber, language);
  }
}

module.exports = { PlayerService };