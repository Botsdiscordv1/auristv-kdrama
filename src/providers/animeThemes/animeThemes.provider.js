const { MetadataProvider } = require('../base/MetadataProvider');

const ONE_DAY = 86400000;
const SKIP_FORMATS = ['SPECIAL', 'OVA', 'PV', 'CM', 'MUSIC'];

function createSlug(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

class AnimeThemesProvider extends MetadataProvider {
  constructor() {
    super('AnimeThemes', 'https://api.animethemes.moe', {
      timeout: 5000,
      cacheTTL: ONE_DAY,
    });
  }

  async getByMalId(malId) {
    return this._executeRequest(
      async () => {
        const url = `/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]=${malId}&include=animethemes.animethemeentries.videos,animethemes.song,animethemes.song.artists,images`;
        const { data } = await this.client.get(url);
        return data?.anime?.[0] || null;
      },
      ['byMalId', String(malId)],
      ONE_DAY
    );
  }

  async getBySlug(slug) {
    return this._executeRequest(
      async () => {
        const url = `/anime/${slug}?include=animethemes.animethemeentries.videos,animethemes.song,animethemes.song.artists,images`;
        const { data } = await this.client.get(url);
        return data?.anime || null;
      },
      ['bySlug', slug],
      ONE_DAY
    );
  }

  async getThemes(identity, malId) {
    const fmt = String(identity.format || '').toUpperCase().trim();
    if (SKIP_FORMATS.includes(fmt)) return null;

    let anime = malId ? await this.getByMalId(malId) : null;

    if (!anime) {
      const slugs = [
        createSlug(identity.romaji || ''),
        createSlug(identity.english || ''),
        createSlug(identity.native || ''),
      ].filter(Boolean);

      for (const slug of [...new Set(slugs)]) {
        anime = await this.getBySlug(slug);
        if (anime) break;
      }
    }

    if (!anime?.animethemes?.length) return null;

    return this._extractThemes(anime);
  }

  _extractThemes(anime) {
    const themes = [];
    for (const theme of (anime.animethemes || [])) {
      const entry = theme.animethemeentries?.[0];
      const video = entry?.videos?.[0];
      const song = theme.song;
      themes.push({
        type: theme.type === 'OP' ? 'OP' : 'ED',
        songName: song?.title || '',
        artist: (song?.artists || []).map(a => a.name).join(', '),
        episodes: theme.episodes || '',
        videoUrl: video?.link || null,
        audioUrl: video?.audio?.link || null,
      });
    }
    return themes;
  }
}

module.exports = { AnimeThemesProvider };