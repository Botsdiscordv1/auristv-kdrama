function toEpisodeDTO(ep = {}) {
  return {
    number: ep.episodeNumber ?? ep.number ?? 0,
    title: ep.title || ep.name || null,
    overview: ep.overview || ep.description || null,
    duration: ep.duration || ep.runtime || null,
    image: ep.image || ep.thumbnail || ep.still || null,
    airDate: ep.airDate || ep.air_date || null,
    isFiller: ep.isFiller ?? false,
    isRecap: ep.isRecap ?? false,
  };
}

function toEpisodeListDTO(episodes = []) {
  return episodes.map(toEpisodeDTO);
}

module.exports = { toEpisodeDTO, toEpisodeListDTO };