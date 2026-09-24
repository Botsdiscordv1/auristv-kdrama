const { AnimeSummary } = require('../../models/AnimeSummary');
const { AnimeDetail } = require('../../models/AnimeDetail');
const { Episode } = require('../../models/Episode');

function toAnimeSummary(item) {
  if (!item) return null;
  return new AnimeSummary({
    id: item.id,
    title: item.name || item.original_name || item.title,
    romaji: item.original_name || item.original_title || null,
    english: item.name || item.title || null,
    thumbnail: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : null,
    banner: item.backdrop_path
      ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
      : null,
    source: 'TMDB',
    year: (item.first_air_date || '').split('-')[0] || null,
    fullDate: item.first_air_date || null,
    score: item.vote_average || null,
    genres: item.genre_ids || [],
    format: item.media_type === 'movie' ? 'Movie' : 'TV',
    sources: [],
    availableSources: [],
  });
}

function toAnimeSummaryList(results) {
  return (results || []).map(toAnimeSummary).filter(Boolean);
}

function toEpisode(ep, lang = 'en-US') {
  if (!ep) return null;
  return new Episode({
    number: ep.episode_number,
    id: ep.id,
    name: ep.name || '',
    overview: ep.overview || '',
    stillPath: ep.still_path
      ? `https://image.tmdb.org/t/p/w780${ep.still_path}`
      : null,
    thumbnail: ep.still_path
      ? `https://image.tmdb.org/t/p/w780${ep.still_path}`
      : null,
    airDate: ep.air_date || null,
    runtime: ep.runtime || null,
  });
}

function toEpisodeList(episodes) {
  return (episodes || []).map(e => toEpisode(e)).filter(Boolean);
}

function toDetail(show, detail) {
  if (!show) return null;
  return new AnimeDetail({
    title: show.name || show.original_name || show.title || show.original_title,
    english: show.name || show.title || null,
    // Eliminamos 'native' para centrar el esfuerzo en Romaji e Inglés
    description: show.overview || '',
    overview: show.overview || '',
    thumbnail: show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : null,
    poster: show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : null,
    banner: show.backdrop_path
      ? `https://image.tmdb.org/t/p/original${show.backdrop_path}`
      : null,
    backdrop: show.backdrop_path
      ? `https://image.tmdb.org/t/p/original${show.backdrop_path}`
      : null,
    genres: (show.genres || []).map(g => g.name),
    studios: (show.production_companies || []).map(c => c.name),
    status: show.status || null,
    episodes: show.number_of_episodes || null,
    seasonsCount: show.number_of_seasons || null,
    seasonList: (show.seasons || []).filter(s => s.season_number > 0).map(s => ({
      seasonNumber: s.season_number,
      airDate: s.air_date || null,
      episodeCount: s.episode_count || 0,
    })),
    score: show.vote_average || null,
    voteCount: show.vote_count || null,
    tmdbId: show.id,
    rating: show.vote_average || null,
    certification: _extractCertification(detail),
    trailerKey: _extractTrailerKey(detail),
    language: show.original_language || 'ja',
    firstAirDate: show.first_air_date || show.release_date || null,
    source: 'TMDB',
  });
}

function _extractTrailerKey(detail) {
  const videos = detail?.videos?.results || [];
  const t = videos.find(v => v.type === 'Trailer' && v.site === 'YouTube');
  return t?.key || null;
}

function _extractCertification(detail) {
  const pickNonEmpty = (values) => values.find(v => typeof v === 'string' && v.trim().length > 0)?.trim() || null;
  const preferredRegions = ['US', 'JP', 'MX', 'ES', 'GB', 'BR', 'AR', 'CL', 'CO', 'PE'];

  if (detail?.release_dates?.results) {
    const results = detail.release_dates.results;
    for (const region of preferredRegions) {
      const match = results.find(r => r.iso_3166_1 === region);
      const cert = pickNonEmpty((match?.release_dates || []).map(r => r.certification));
      if (cert) return cert;
    }
    for (const region of results) {
      const cert = pickNonEmpty((region.release_dates || []).map(r => r.certification));
      if (cert) return cert;
    }
  }

  if (detail?.content_ratings?.results) {
    const results = detail.content_ratings.results;
    for (const region of preferredRegions) {
      const match = results.find(r => r.iso_3166_1 === region);
      const cert = pickNonEmpty([match?.rating]);
      if (cert) return cert;
    }
    const any = pickNonEmpty(results.map(r => r.rating));
    if (any) return any;
  }

  return null;
}

module.exports = { toAnimeSummary, toAnimeSummaryList, toEpisode, toEpisodeList, toDetail };
