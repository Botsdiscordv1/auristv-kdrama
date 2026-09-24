function toScheduleDTO(data = {}) {
  return {
    nextEpisode: data.nextEpisode ?? data.episode ?? null,
    airDate: data.airDate || data.episodeDate || null,
    countdown: data.countdown ?? data.airingAt ?? null,
    status: data.status || data.airingStatus || null,
  };
}

module.exports = { toScheduleDTO };