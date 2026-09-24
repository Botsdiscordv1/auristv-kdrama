function toAnimeCardDTO(data = {}) {
  return {
    id: data.id ? String(data.id) : null,
    title: data.title || data.romaji || '',
    poster: data.poster || data.thumbnail || null,
    score: data.score ?? data.averageScore ?? null,
    year: data.year || null,
    type: data.format || data.type || 'UNKNOWN',
    episodes: data.episodes || null,
  };
}

function toAnimeDetailDTO(data = {}) {
  return {
    id: data.id ? String(data.id) : null,
    title: data.title || data.romaji || '',
    titleEnglish: data.english || data.titleEnglish || null,
    titleJapanese: data.native || data.titleJapanese || null,
    synonyms: data.synonyms || [],
    description: data.description || data.overview || null,
    type: data.format || data.type || 'UNKNOWN',
    status: data.status || 'UNKNOWN',
    season: data.season || null,
    year: data.year || null,
    episodes: data.episodes || null,
    duration: data.duration || null,
    score: data.score ?? data.averageScore ?? null,
    genres: data.genres || [],
    tags: data.tags || [],
    studios: data.studios || [],
    certification: data.certification || null,
    trailer: data.trailer ? _toTrailerDTO(data.trailer, data.trailerKey) : null,
    relations: (data.relations || []).map(_toRelationDTO),
    recommendations: (data.recommendations || []).map(_toRecommendationDTO),
  };
}

function toAnimePlayerDTO(data = {}) {
  return {
    id: data.id ? String(data.id) : null,
    title: data.title || data.romaji || '',
    titleEnglish: data.english || null,
    titleJapanese: data.native || null,
    format: data.format || 'TV',
    genres: data.genres || [],
    score: data.score ?? data.averageScore ?? null,
  };
}

function _toTrailerDTO(trailer, trailerKey) {
  if (!trailer && !trailerKey) return null;
  const site = trailer?.site || 'youtube';
  const videoId = trailer?.id || trailerKey || null;
  return {
    site,
    videoId,
    thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
  };
}

function _toRelationDTO(rel = {}) {
  return {
    id: rel.id ? String(rel.id) : null,
    title: rel.title?.romaji || rel.title || '',
    relation: rel.relationType || rel.relation || rel.type || 'UNKNOWN',
    poster: rel.poster || rel.thumbnail || null,
  };
}

function _toRecommendationDTO(rec = {}) {
  return {
    id: rec.id ? String(rec.id) : null,
    title: rec.title?.romaji || rec.title || '',
    poster: rec.poster || rec.thumbnail || null,
    score: rec.score ?? rec.averageScore ?? null,
  };
}

module.exports = { toAnimeCardDTO, toAnimeDetailDTO, toAnimePlayerDTO };
