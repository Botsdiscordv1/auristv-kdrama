class AnimeSummary {
  constructor(data = {}) {
    this.id = data.id || null;
    this.title = data.title || '';
    this.romaji = data.romaji || null;
    this.english = data.english || null;
    this.native = data.native || null;
    this.slug = data.slug || '';
    this.url = data.url || '';
    this.thumbnail = data.thumbnail || null;
    this.banner = data.banner || null;
    this.source = data.source || '';
    this.sources = data.sources || [];
    this.availableSources = data.availableSources || [];
    this.quality = data.quality || '';
    this.year = data.year || null;
    this.fullDate = data.fullDate || null;
    this.score = data.score || null;
    this.genres = data.genres || [];
    this.format = data.format || null;
    this.status = data.status || null;
    this.episode = data.episode || null;
    this.totalEpisodes = data.totalEpisodes || null;
    this.airingAt = data.airingAt || null;
    this.aired = data.aired || false;
    this.trailerKey = data.trailerKey || null;
    this.metadataTitle = data.metadataTitle || null;
    this.scrapedTitle = data.scrapedTitle || null;
  }
}

module.exports = { AnimeSummary };
