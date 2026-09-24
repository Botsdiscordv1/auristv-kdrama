const { ScheduleCache } = require('../cache/AnimeCache');
const { ScheduleAggregator } = require('../aggregators/ScheduleAggregator');

class ScheduleRepository {
  constructor() {
    this.aggregator = new ScheduleAggregator();
    this.cache = new ScheduleCache(60 * 60 * 1000);
    this._buildPromise = null;
  }

  async getSchedule() {
    const cached = this.cache.get();
    if (cached) return this._markToday(cached);
    if (this._buildPromise) {
      const cached = this.cache.get();
      if (cached) return this._markToday(cached);
      return this._buildPromise;
    }

    this._buildPromise = this._build();
    try {
      return await this._buildPromise;
    } finally {
      this._buildPromise = null;
    }
  }

  warmUp() {
    setTimeout(() => {
      this.getSchedule()
        .then(() => console.log('[ScheduleRepo] Cache pre-warmed'))
        .catch(() => {});
    }, 3000);
  }

  async _build() {
    const schedule = await this.aggregator.getSchedule();
    this.cache.set(schedule);
    return schedule;
  }

  _markToday(schedule) {
    const todayIdx = (new Date().getDay() + 6) % 7;
    return {
      ...schedule,
      days: schedule.days.map(d => ({ ...d, isToday: d.dayIndex === todayIdx })),
    };
  }
}

module.exports = { ScheduleRepository };
