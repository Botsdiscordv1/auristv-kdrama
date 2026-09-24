function toVisualDTO(data = {}) {
  return {
    poster: data.poster || data.thumbnail || null,
    banner: data.banner || null,
    backdrop: data.backdrop || null,
    logo: data.logo || null,
    color: data.color || null,
    thumbnail: data.thumbnail || data.poster || null,
    overview: data.description || data.overview || null,
    certification: data.certification || null,
  };
}

module.exports = { toVisualDTO };