class ScheduleEntry {
  constructor(data = {}) {
    this.id = data.id || 0;
    this.title = data.title || '';
    this.romaji = data.romaji || null;
    this.english = data.english || null;
    this.native = data.native || null;
    this.description = data.description || '';
    this.coverImage = data.coverImage || null;
    this.genres = data.genres || [];
    this.studio = data.studio || null;
    this.episodes = data.episodes || null;
    this.format = data.format || 'TV';
    this.status = data.status || 'RELEASING';
    this.score = data.score || null;
    this.nextEpisode = data.nextEpisode || null;
    this.airingAt = data.airingAt || null;
    this.episode = data.episode || 0;
    this.aired = data.aired || false;
    this.sourceAvailable = data.sourceAvailable || false;
    this.day = data.day || null;
    this.dayIndex = data.dayIndex ?? -1;
  }
}

module.exports = { ScheduleEntry };
