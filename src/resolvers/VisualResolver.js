class VisualResolver {
  constructor(tmdbProvider) {
    this.tmdb = tmdbProvider;
  }

  resolvePoster(tmdbDetail, anilistDetail) {
    return tmdbDetail?.poster || anilistDetail?.thumbnail || null;
  }

  resolveBackdrop(tmdbDetail, anilistDetail) {
    return tmdbDetail?.backdrop || anilistDetail?.banner || null;
  }

  resolveBanner(anilistDetail) {
    return anilistDetail?.banner || null;
  }

  resolveLogo(tmdbDetail) {
    return tmdbDetail?.logo || null;
  }

  async searchTMDB(title) {
    return this.tmdb.searchBest(title);
  }

  async searchTV(query, language = 'es-MX') {
    return this.tmdb.searchTV(query, language);
  }

  async findTV(query, language = 'es-MX') {
    return this.tmdb.findTV(query, language);
  }

  async getTVDetail(tmdbId, language) {
    return this.tmdb.getTVDetail(tmdbId, language);
  }

  async getMovieDetail(tmdbId, language) {
    return this.tmdb.getMovieDetail(tmdbId, language);
  }

  async getTrending(language = 'es-MX') {
    return this.tmdb.getTrending(language);
  }

  async getTrendingMovies(language = 'es-MX') {
    return this.tmdb.getTrendingMovies(language);
  }
}

module.exports = { VisualResolver };