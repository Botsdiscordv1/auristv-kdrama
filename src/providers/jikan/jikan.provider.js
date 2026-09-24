const { MetadataProvider } = require('../base/MetadataProvider');

const HALF_HOUR = 1800000;

class JikanProvider extends MetadataProvider {
  constructor() {
    super('Jikan', 'https://api.jikan.moe/v4', { timeout: 6000 });
  }

  async getCharacters(malId) {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/anime/${malId}/characters`);
        return (data.data || []).map(c => ({
          malId: c.character?.mal_id,
          name: c.character?.name,
          image: c.character?.images?.jpg?.image_url,
          role: c.role,
          voiceActors: (c.voice_actors || []).map(va => ({
            name: va.person?.name,
            image: va.person?.images?.jpg?.image_url,
            language: va.language,
          })),
        }));
      },
      ['characters', String(malId)],
      HALF_HOUR
    );
  }

  async getStaff(malId) {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/anime/${malId}/staff`);
        return (data.data || []).map(s => ({
          malId: s.person?.mal_id,
          name: s.person?.name,
          image: s.person?.images?.jpg?.image_url,
          positions: s.positions || [],
        }));
      },
      ['staff', String(malId)],
      HALF_HOUR
    );
  }
}

module.exports = { JikanProvider };