class Episode {
  constructor(data = {}) {
    this.number = data.number || 0;
    this.id = data.id || null;
    this.name = data.name || '';
    this.overview = data.overview || '';
    this.thumbnail = data.thumbnail || null;
    this.stillPath = data.stillPath || null;
    this.airDate = data.airDate || null;
    this.runtime = data.runtime || null;
    this.url = data.url || null;
  }
}

module.exports = { Episode };
