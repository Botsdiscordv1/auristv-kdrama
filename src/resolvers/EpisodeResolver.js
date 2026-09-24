class EpisodeResolver {
  constructor(tmdbProvider) {
    this.tmdb = tmdbProvider;
  }

  async resolve(tmdbId, seasonNumber, language = 'es-MX') {
    if (!tmdbId || !seasonNumber) return null;
    return this.tmdb.getSeason(tmdbId, seasonNumber, language);
  }
}

module.exports = { EpisodeResolver };