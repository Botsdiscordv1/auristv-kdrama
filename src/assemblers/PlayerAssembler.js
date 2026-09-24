const { toAnimePlayerDTO } = require('../dto/AnimeDTO');
const { toVisualDTO } = require('../dto/VisualDTO');
const { toEpisodeDTO } = require('../dto/EpisodeDTO');
const { toThemeListDTO } = require('../dto/ThemeDTO');
const { toContinueWatchingDTO } = require('../dto/ContinueWatchingDTO');
const { toServerListDTO } = require('../dto/ServerDTO');

class PlayerAssembler {
  assemble({ identity, visual, episode, themes, episodeNumber, servers }) {
    const anime = toAnimePlayerDTO(identity);
    const visuals = toVisualDTO({ ...visual, ...identity });
    const episodeDTO = toEpisodeDTO({ ...episode, episodeNumber });
    const themeList = toThemeListDTO(themes || []);
    const serverList = toServerListDTO(servers || []);

    return {
      anime,
      episode: episodeDTO,
      visuals,
      themes: themeList,
      continueWatching: toContinueWatchingDTO(null),
      servers: serverList,
      defaultServer: serverList.length > 0 ? serverList[0].id : null,
    };
  }
}

module.exports = { PlayerAssembler };