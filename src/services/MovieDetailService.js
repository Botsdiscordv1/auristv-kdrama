const { fetchMovieSeriesDetail } = require('../../services/movie-series-detail');

class MovieDetailService {
  async getDetail({ title, year, metadataTitle, url, quality, type, kind, mediaType } = {}) {
    return fetchMovieSeriesDetail({ title, year, metadataTitle, url, quality, type, kind, mediaType });
  }
}

module.exports = { MovieDetailService };