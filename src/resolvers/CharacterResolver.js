class CharacterResolver {
  constructor(jikanProvider, anilistProvider) {
    this.jikan = jikanProvider;
    this.anilist = anilistProvider;
  }

  async resolve(malId) {
    if (!malId) return [];

    const characters = await this.jikan.getCharacters(malId);
    if (characters?.length) return characters;

    return [];
  }

  async resolveStaff(malId) {
    if (!malId) return [];

    const staff = await this.jikan.getStaff(malId);
    if (staff?.length) return staff;

    return [];
  }
}

module.exports = { CharacterResolver };