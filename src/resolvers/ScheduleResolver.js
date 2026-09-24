class ScheduleResolver {
  constructor(animeScheduleProvider, anilistProvider) {
    this.schedule = animeScheduleProvider;
    this.anilist = anilistProvider;
  }

  async resolve(airType = 'sub') {
    const timetables = await this.schedule.getTimetables(airType);
    return timetables || [];
  }

  async resolveAnime(route) {
    return this.schedule.getAnime(route);
  }
}

module.exports = { ScheduleResolver };