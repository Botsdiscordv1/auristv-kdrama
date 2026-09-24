const { fetchMovieSeriesDetail } = require('../../services/anime-detail');

class MovieDetailService {
  async getDetail({ title, year, metadataTitle, url, quality } = {}) {
    return fetchMovieSeriesDetail({ title, year, metadataTitle, url, quality });
  }
}

module.exports = { MovieDetailService };