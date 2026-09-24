const { ScheduleRepository } = require('../repositories/ScheduleRepository');

class ScheduleService {
  constructor() {
    this.repository = new ScheduleRepository();
  }

  async getSchedule() {
    return this.repository.getSchedule();
  }
}

module.exports = { ScheduleService };