const { toAnimeCardDTO, toAnimeDetailDTO, toAnimePlayerDTO } = require('./AnimeDTO');
const { toVisualDTO } = require('./VisualDTO');
const { toEpisodeDTO, toEpisodeListDTO } = require('./EpisodeDTO');
const { toCharacterDTO, toCharacterListDTO } = require('./CharacterDTO');
const { toScheduleDTO } = require('./ScheduleDTO');
const { toThemeDTO, toThemeListDTO } = require('./ThemeDTO');
const { success, error } = require('./ApiResponseDTO');
const { toApiErrorDTO, ERROR_CODES } = require('./ApiErrorDTO');
const { toPaginationDTO } = require('./PaginationDTO');
const { toContinueWatchingDTO } = require('./ContinueWatchingDTO');
const { toServerDTO, toServerListDTO } = require('./ServerDTO');
const { toResponseMetadataDTO } = require('./ResponseMetadataDTO');
const { toCacheMetadataDTO } = require('./CacheMetadataDTO');
const { toRequestContextDTO } = require('./RequestContextDTO');
const { toHealthDTO } = require('./HealthDTO');

module.exports = {
  toAnimeCardDTO,
  toAnimeDetailDTO,
  toAnimePlayerDTO,
  toVisualDTO,
  toEpisodeDTO,
  toEpisodeListDTO,
  toCharacterDTO,
  toCharacterListDTO,
  toScheduleDTO,
  toThemeDTO,
  toThemeListDTO,
  success,
  error,
  toApiErrorDTO,
  ERROR_CODES,
  toPaginationDTO,
  toContinueWatchingDTO,
  toServerDTO,
  toServerListDTO,
  toResponseMetadataDTO,
  toCacheMetadataDTO,
  toRequestContextDTO,
  toHealthDTO,
};