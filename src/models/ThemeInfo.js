class ThemeInfo {
  constructor(data = {}) {
    this.type = data.type || ''; // 'OP' | 'ED'
    this.songName = data.songName || '';
    this.artist = data.artist || '';
    this.episodes = data.episodes || '';
    this.videoUrl = data.videoUrl || null;
    this.audioUrl = data.audioUrl || null;
  }
}

module.exports = { ThemeInfo };
