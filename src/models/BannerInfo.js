class BannerInfo {
  constructor(data = {}) {
    this.url = data.url || null;
    this.thumbnailUrl = data.thumbnailUrl || null;
    this.source = data.source || '';
    this.confidence = data.confidence || 0;
  }
}

module.exports = { BannerInfo };
