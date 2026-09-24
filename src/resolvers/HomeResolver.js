class HomeResolver {
  constructor(anilistProvider) {
    this.anilist = anilistProvider;
  }

  async getTrending() {
    const season = this._getCurrentSeason();
    const year = new Date().getFullYear();
    const results = await this.anilist.getTrending(season, year);
    return results || [];
  }

  _getCurrentSeason() {
    const m = new Date().getMonth() + 1;
    if (m <= 3) return 'WINTER';
    if (m <= 6) return 'SPRING';
    if (m <= 9) return 'SUMMER';
    return 'FALL';
  }
}

module.exports = { HomeResolver };