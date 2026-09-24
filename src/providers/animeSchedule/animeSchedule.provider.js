const { MetadataProvider } = require('../base/MetadataProvider');

const FIFTEEN_MIN = 900000;

class AnimeScheduleProvider extends MetadataProvider {
  constructor() {
    const token = process.env.ANIMESCHEDULE_API_KEY;
    super('AnimeSchedule', 'https://animeschedule.net/api/v3', {
      timeout: 10000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cacheTTL: FIFTEEN_MIN,
    });
  }

  async getTimetables(airType = 'sub') {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/timetables/${airType}`);
        return data || [];
      },
      ['timetables', airType],
      FIFTEEN_MIN
    );
  }

  async getAnime(route) {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(`/anime/${route}`);
        return data || null;
      },
      ['anime', String(route)],
      FIFTEEN_MIN
    );
  }
}

module.exports = { AnimeScheduleProvider };