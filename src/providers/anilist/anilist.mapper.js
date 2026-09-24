const { AnimeSummary } = require('../../models/AnimeSummary');
const { AnimeDetail } = require('../../models/AnimeDetail');

function toAnimeSummary(media) {
  if (!media) return null;
  return new AnimeSummary({
    id: media.id,
    title: media.title?.romaji || media.title?.english || media.title?.native,
    romaji: media.title?.romaji || null,
    english: media.title?.english || null,
    // Eliminamos 'native' para no ensuciar la cadena de búsqueda con Kanji/Thai/etc.
    thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || null,
    banner: media.bannerImage || null,
    trailerKey: media.trailer?.site === 'youtube' ? media.trailer.id : null,
    source: 'AniList',
    score: media.averageScore ? Math.round(media.averageScore / 10 * 10) / 10 : null,
    genres: media.genres || [],
    format: media.format || null,
    status: media.status || null,
    episode: media.nextAiringEpisode?.episode ? Math.max(1, media.nextAiringEpisode.episode - 1) : null,
    totalEpisodes: media.episodes || null,
    airingAt: media.nextAiringEpisode?.airingAt || null,
    year: media.startDate?.year || null,
    fullDate: media.startDate ? `${media.startDate.year || ''}-${String(media.startDate.month || 1).padStart(2, '0')}-${String(media.startDate.day || 1).padStart(2, '0')}` : null,
    sources: [],
    availableSources: [],
  });
}

function toAnimeSummaryList(mediaList) {
  return (mediaList || []).map(toAnimeSummary).filter(Boolean);
}

function toDetail(media) {
  if (!media) return null;
  const year = media.startDate?.year || null;
  const month = String(media.startDate?.month || 1).padStart(2, '0');
  const day = String(media.startDate?.day || 1).padStart(2, '0');
  return new AnimeDetail({
    title: media.title?.romaji || media.title?.english || media.title?.native,
    romaji: media.title?.romaji || null,
    english: media.title?.english || null,
    synonyms: media.synonyms || [],
    description: (media.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
    overview: (media.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
    thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || null,
    banner: media.bannerImage || null,
    genres: media.genres || [],
    studios: (media.studios?.nodes || []).map(n => n.name),
    season: media.season || null,
    year,
    fullDate: year ? `${year}-${month}-${day}` : null,
    format: media.format || null,
    status: media.status || null,
    episodes: media.episodes || null,
    duration: media.duration || null,
    score: media.averageScore ? Math.round(media.averageScore / 10 * 10) / 10 : null,
    trailer: media.trailer || null,
    trailerKey: media.trailer?.site === 'youtube' ? media.trailer.id : null,
    relations: (media.relations?.edges || []).map(e => ({
      type: e.relationType,
      title: e.node?.title?.romaji,
      format: e.node?.format,
    })),
    source: 'AniList',
    malId: media.idMal || null,
    rating: media.averageScore ? Math.round(media.averageScore / 10 * 10) / 10 : null,
    seasonsCount: null,
  });
}

module.exports = { toAnimeSummary, toAnimeSummaryList, toDetail };
