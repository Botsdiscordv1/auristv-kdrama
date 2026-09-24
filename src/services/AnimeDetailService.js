const { AnimeRepository } = require('../repositories/AnimeRepository');

class AnimeDetailService {
  constructor() {
    this.repository = new AnimeRepository();
  }

  async getDetail(title, malId = null, metadataTitle = null, year = null) {
    return this.repository.getDetail(title, malId, metadataTitle, year);
  }
}

module.exports = { AnimeDetailService };