const { toAnimeDetailDTO } = require('../dto/AnimeDTO');
const { toVisualDTO } = require('../dto/VisualDTO');
const { toEpisodeListDTO } = require('../dto/EpisodeDTO');
const { toCharacterListDTO } = require('../dto/CharacterDTO');
const { toScheduleDTO } = require('../dto/ScheduleDTO');
const { toThemeListDTO } = require('../dto/ThemeDTO');

const TRANSLATE_TIMEOUT = 5000;

class AnimeDetailAssembler {
  assemble({ identity, visual, episodes, characters, schedule, themes }) {
    const anime = toAnimeDetailDTO(identity);
    const visuals = toVisualDTO({ ...visual, ...identity, certification: visual?.certification ?? null });
    const episodeList = toEpisodeListDTO(episodes?.episodes || []);
    const characterList = toCharacterListDTO(characters || []);
    const scheduleData = toScheduleDTO(schedule || {});
    const themeList = toThemeListDTO(themes || []);

    return { anime, visuals, episodes: episodeList, characters: characterList, schedule: scheduleData, themes: themeList };
  }

  async buildDTO(data) {
    const overview = data.visuals?.overview || data.anime?.description || null;
    const translated = overview ? await this._translateToSpanish(overview) : null;

    if (translated) {
      if (data.anime) data.anime.description = translated;
      if (data.visuals) data.visuals.overview = translated;
    }

    return {
      anime: data.anime,
      visuals: data.visuals,
      episodes: data.episodes,
      characters: data.characters,
      schedule: data.schedule,
      themes: data.themes,
      statistics: {
        score: data.anime?.score ?? null,
        popularity: null,
        favorites: null,
        members: null,
        ranking: null,
      },
      externalLinks: [],
    };
  }

  async _translateToSpanish(text) {
    if (!text || text.length < 20) return null;
    try {
      const { translate } = require('@vitalets/google-translate-api');
      const result = await Promise.race([
        translate(text, { to: 'es' }),
        new Promise(r => setTimeout(() => r(null), TRANSLATE_TIMEOUT)),
      ]);
      if (!result) return null;
      const cleaned = result.text.replace('[Written by MAL Rewrite]', '').trim();
      return cleaned || null;
    } catch {
      return null;
    }
  }
}

module.exports = { AnimeDetailAssembler };