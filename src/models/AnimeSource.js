class AnimeSource {
  constructor(data = {}) {
    this.source = data.source || '';
    this.url = data.url || '';
    this.quality = data.quality || '';
  }
}

module.exports = { AnimeSource };
