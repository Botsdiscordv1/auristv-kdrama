class BannerResolver {
  constructor(visualResolver) {
    this.visual = visualResolver;
  }

  async resolve(title, existingBanner = null) {
    if (existingBanner && !existingBanner.includes('placeholder')) {
      return { url: existingBanner, source: 'provided' };
    }

    const result = await this.visual.searchTMDB(title);
    if (result?.backdrop) {
      return { url: result.backdrop, source: 'tmdb' };
    }

    return null;
  }

  async enrichBatch(items) {
    const toEnrich = items.filter(r => !r.banner).slice(0, 20);
    if (!toEnrich.length) return;

    const results = await Promise.allSettled(
      toEnrich.map(item => this.resolve(item.title))
    );

    for (let i = 0; i < toEnrich.length; i++) {
      const banner = results[i]?.status === 'fulfilled' ? results[i].value : null;
      if (banner?.url) toEnrich[i].banner = banner.url;
    }
  }
}

module.exports = { BannerResolver };