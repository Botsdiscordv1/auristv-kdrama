const { MetadataProvider } = require('../base/MetadataProvider');
const { query } = require('./anilist.client');
const mappers = require('./anilist.mapper');

const SEARCH_QUERY = `
  query ($search: String, $page: Int, $year: Int) {
    Page(page: $page, perPage: 10) {
      media(search: $search, type: ANIME, isAdult: false, seasonYear: $year) {
        id idMal
        title { romaji english native }
        coverImage { extraLarge large medium }
        bannerImage
        format
        episodes
        status
        genres
        averageScore
        startDate { year month day }
        nextAiringEpisode { airingAt episode }
        synonyms
        description
        duration
        season
        studios { nodes { name } }
        relations { edges { relationType node { title { romaji } format } } }
        trailer { id site }
      }
    }
  }
`;

const TRENDING_QUERY = `
  query ($page: Int, $season: MediaSeason, $year: Int) {
    Page(page: $page, perPage: 50) {
      media(season: $season, seasonYear: $year, type: ANIME, format_in: [TV, ONA, MOVIE], status_in: [RELEASING, NOT_YET_RELEASED, FINISHED], sort: POPULARITY_DESC, isAdult: false) {
        id idMal
        title { romaji english native }
        coverImage { extraLarge large medium }
        bannerImage
        format
        episodes
        status
        genres
        averageScore
        startDate { year month day }
        nextAiringEpisode { airingAt episode }
        trailer { id site }
      }
    }
  }
`;

const MOVIE_QUERY = `
  query ($page: Int) {
    Page(page: $page, perPage: 50) {
      media(type: ANIME, format: MOVIE, sort: TRENDING_DESC, isAdult: false) {
        id idMal
        title { romaji english native }
        coverImage { extraLarge large medium }
        bannerImage
        format
        episodes
        status
        genres
        averageScore
        startDate { year month day }
        nextAiringEpisode { airingAt episode }
        trailer { id site }
      }
    }
  }
`;

const FRANCHISE_QUERY = `
  query ($s: String) {
    Media(search: $s, type: ANIME) {
      relations { edges { relationType node { id title { romaji } format } } }
    }
  }
`;

class AniListProvider extends MetadataProvider {
  constructor() {
    super('AniList', 'https://graphql.anilist.co', {
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' },
      cacheTTL: 1800000,
    });
  }

  async search(queryStr, page = 1, year = null) {
    const y = year ? parseInt(year, 10) : null;
    const variables = { search: queryStr, page, year: y };

    try {
      const resp = await query(SEARCH_QUERY, variables);
      const media = resp?.data?.Page?.media || [];
      if (media.length > 0) return mappers.toAnimeSummaryList(media);

      // Fallback: si no hay resultados con año, intentamos sin año
      if (y) {
        console.log(`[AniList] Sin resultados para "${queryStr}" en ${y}. Intentando búsqueda general...`);
        const respAll = await query(SEARCH_QUERY, { search: queryStr, page });
        return mappers.toAnimeSummaryList(respAll?.data?.Page?.media || []);
      }
    } catch (err) {
      if (err.response?.status === 400 && y) {
        return this.search(queryStr, page, null); // Re-intentar sin año si hay error de tipo
      }
      throw err;
    }
    return [];
  }

  async getDetail(queryStr, year = null) {
    const y = year ? parseInt(year, 10) : null;
    const variables = { search: queryStr, page: 1, year: y };

    try {
      const resp = await query(SEARCH_QUERY, variables);
      const media = resp?.data?.Page?.media?.[0];
      if (media) return mappers.toDetail(media);

      // Fallback
      if (y) {
        const respAll = await query(SEARCH_QUERY, { search: queryStr, page: 1 });
        const mediaAll = respAll?.data?.Page?.media?.[0];
        if (mediaAll) return mappers.toDetail(mediaAll);
      }
    } catch (err) {
      if (err.response?.status === 400 && y) {
        return this.getDetail(queryStr, null);
      }
      throw err;
    }
    return null;
  }

  async getById(id) {
    const resp = await query(SEARCH_QUERY, { search: id, page: 1 });
    const media = resp?.data?.Page?.media?.[0];
    return media ? mappers.toDetail(media) : null;
  }

  async getTrending(season, year) {
    const resp = await query(TRENDING_QUERY, { page: 1, season, year });
    const media = resp?.data?.Page?.media || [];
    return mappers.toAnimeSummaryList(media);
  }

  async getTrendingMovies() {
    const resp = await query(MOVIE_QUERY, { page: 1 });
    const media = resp?.data?.Page?.media || [];
    return mappers.toAnimeSummaryList(media);
  }

  async getFranchise(baseTitle) {
    const resp = await query(FRANCHISE_QUERY, { s: baseTitle });
    return resp?.data?.Media?.relations?.edges || [];
  }
}

function getCurrentSeason() {
  const m = new Date().getMonth() + 1;
  if (m <= 3) return 'WINTER';
  if (m <= 6) return 'SPRING';
  if (m <= 9) return 'SUMMER';
  return 'FALL';
}

module.exports = { AniListProvider, getCurrentSeason };