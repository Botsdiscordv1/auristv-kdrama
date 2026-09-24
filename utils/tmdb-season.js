const axios = require('axios');
const { isGenericEpisodeName } = require('./title-utils');

async function fetchEpisodeDetail(id, season, episodeNumber, getTMDBKey) {
  if (!getTMDBKey()) return null;

  const { data } = await axios
    .get(`https://api.themoviedb.org/3/tv/${id}/season/${season}/episode/${episodeNumber}`, {
      params: { api_key: getTMDBKey(), language: 'en-US' },
      timeout: 8000,
    })
    .catch(() => ({ data: null }));

  return data || null;
}

function mergeLocalizedEpisodes(tmdbEpisodes, mxEpisodes = [], esEsEpisodes = []) {
  if (!tmdbEpisodes?.length) return [];

  return tmdbEpisodes.map((enEp) => {
    const mx = mxEpisodes.find(e => e.episode_number === enEp.episode_number);
    const ee = esEsEpisodes.find(e => e.episode_number === enEp.episode_number);
    return {
      episode_number: enEp.episode_number,
      id: enEp.id,
      name: mx && !isGenericEpisodeName(mx.name) ? mx.name : (ee && !isGenericEpisodeName(ee.name) ? ee.name : enEp.name),
      overview: mx && !isGenericEpisodeName(mx.overview) ? mx.overview : (ee && !isGenericEpisodeName(ee.overview) ? ee.overview : enEp.overview),
      still_path: mx?.still_path || ee?.still_path || null,
      air_date: mx?.air_date || ee?.air_date || null,
      runtime: enEp.runtime || null,
    };
  });
}

async function fetchTmdbSeasonEpisodes(id, season, getTMDBKey) {
  if (!getTMDBKey()) return null;

  const [resEsMx, resEsEs, resEn] = await Promise.all([
    axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${season}`, { params: { api_key: getTMDBKey(), language: 'es-MX' } }).catch(() => null),
    axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${season}`, { params: { api_key: getTMDBKey(), language: 'es-ES' } }).catch(() => null),
    axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${season}`, { params: { api_key: getTMDBKey(), language: 'en-US' } }).catch(() => null),
  ]);

  const tmdbEpisodes = resEn?.data?.episodes || [];
  if (!tmdbEpisodes.length) return null;

  const mxEpisodes = resEsMx?.data?.episodes || [];
  const esEsEpisodes = resEsEs?.data?.episodes || [];
  const localizedEpisodes = (mxEpisodes.length || esEsEpisodes.length)
    ? mergeLocalizedEpisodes(tmdbEpisodes, mxEpisodes, esEsEpisodes)
    : tmdbEpisodes;

  const missingThumbs = localizedEpisodes.filter(ep => !ep.still_path);
  if (missingThumbs.length > 0) {
    const details = await Promise.all(
      missingThumbs.map(ep => fetchEpisodeDetail(id, season, ep.episode_number, getTMDBKey))
    );
    const detailsByNumber = new Map(
      details
        .filter(Boolean)
        .map(detail => [detail.episode_number, detail])
    );

    for (const ep of localizedEpisodes) {
      if (ep.still_path) continue;
      const detail = detailsByNumber.get(ep.episode_number);
      if (detail?.still_path) {
        ep.still_path = detail.still_path;
      }
    }
  }

  return {
    tmdbEpisodes,
    localizedEpisodes,
    mxEpisodes,
    esEsEpisodes,
  };
}

module.exports = {
  fetchTmdbSeasonEpisodes,
  mergeLocalizedEpisodes,
  isGenericEpisodeName,
};
