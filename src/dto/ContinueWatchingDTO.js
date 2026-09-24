function toContinueWatchingDTO(data = {}) {
  if (!data.animeId && !data.episodeNumber) return null;
  return {
    animeId: data.animeId ? String(data.animeId) : null,
    episodeNumber: data.episodeNumber ?? null,
    progressSeconds: data.progressSeconds ?? 0,
    durationSeconds: data.durationSeconds ?? 0,
    updatedAt: data.updatedAt || new Date().toISOString(),
    completed: data.completed ?? false,
  };
}

module.exports = { toContinueWatchingDTO };