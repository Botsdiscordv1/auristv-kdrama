const { getEpisodes } = require('../../services/episodes');

class EpisodeService {
  async getEpisodes(url, source, options = {}) {
    return getEpisodes(url, source, options);
  }
}

module.exports = { EpisodeService };