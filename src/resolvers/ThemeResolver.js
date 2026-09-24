class ThemeResolver {
  constructor(animeThemesProvider) {
    this.themes = animeThemesProvider;
  }

  async resolve(identity, malId) {
    const themes = await this.themes.getThemes(identity, malId);
    return themes || [];
  }
}

module.exports = { ThemeResolver };