const { AnimeRepository } = require('../repositories/AnimeRepository');
const { BannerStrategy } = require('../strategy/BannerStrategy');

class HomeService {
  constructor() {
    this.repository = new AnimeRepository();
    this.bannerStrategy = new BannerStrategy();
  }

  async getTrending() {
    const results = await this.repository.getTrending();
    if (results?.length) {
      await this.bannerStrategy.enrichBatch(results);
    }
    return results || [];
  }
}

module.exports = { HomeService };