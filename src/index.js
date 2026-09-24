const { AnimeSummary } = require('./models/AnimeSummary');
const { AnimeDetail } = require('./models/AnimeDetail');
const { Episode } = require('./models/Episode');
const { AnimeSource } = require('./models/AnimeSource');
const { BannerInfo } = require('./models/BannerInfo');
const { ThemeInfo } = require('./models/ThemeInfo');
const { ScheduleEntry } = require('./models/ScheduleEntry');

const { AniListProvider } = require('./providers/anilist/anilist.provider');
const { TMDBProvider } = require('./providers/tmdb/tmdb.provider');
const { JikanProvider } = require('./providers/jikan/jikan.provider');
const { AnimeScheduleProvider } = require('./providers/animeSchedule/animeSchedule.provider');
const { AnimeThemesProvider } = require('./providers/animeThemes/animeThemes.provider');
const { AnimeAV1Provider } = require('./providers/animeav1/animeav1.provider');
const { AnimeFLVProvider } = require('./providers/animeflv/animeflv.provider');
const { JKAnimeProvider } = require('./providers/jkanime/jkanime.provider');
const { registry } = require('./providers/registry/ProviderRegistry');

const {
  IdentityResolver, VisualResolver, CharacterResolver,
  ThemeResolver, ScheduleResolver, EpisodeResolver, UserResolver,
  SearchResolver, HomeResolver, RecommendationResolver, BannerResolver,
} = require('./resolvers');

const { AnimeAggregator } = require('./aggregators/AnimeAggregator');
const { ScheduleAggregator } = require('./aggregators/ScheduleAggregator');
const { SearchAggregator } = require('./aggregators/SearchAggregator');
const { HomeAggregator } = require('./aggregators/HomeAggregator');
const { PlayerAggregator } = require('./aggregators/PlayerAggregator');
const { BannerStrategy } = require('./strategy/BannerStrategy');
const { SearchMergeEngine } = require('./merge/SearchMergeEngine');
const { AnimeDetailAssembler, PlayerAssembler } = require('./assemblers');

const {
  toAnimeCardDTO, toAnimeDetailDTO, toAnimePlayerDTO, toVisualDTO, toEpisodeDTO, toEpisodeListDTO,
  toCharacterDTO, toCharacterListDTO, toScheduleDTO, toThemeDTO, toThemeListDTO,
} = require('./dto');

const {
  SearchService, AnimeDetailService, HomeService, ScheduleService, PlayerService,
  MovieDetailService, EpisodeService, ExtractService,
} = require('./services');

const { AnimeRepository } = require('./repositories/AnimeRepository');
const { ScheduleRepository } = require('./repositories/ScheduleRepository');

module.exports = {
  // Models
  AnimeSummary, AnimeDetail, Episode, AnimeSource, BannerInfo, ThemeInfo, ScheduleEntry,
  // Providers
  AniListProvider, TMDBProvider, JikanProvider, AnimeScheduleProvider, AnimeThemesProvider,
  AnimeAV1Provider, AnimeFLVProvider, JKAnimeProvider,
  // Registry
  registry,
  // Resolvers
  IdentityResolver, VisualResolver, CharacterResolver,
  ThemeResolver, ScheduleResolver, EpisodeResolver, UserResolver,
  SearchResolver, HomeResolver, RecommendationResolver, BannerResolver,
  // Aggregators
  AnimeAggregator, ScheduleAggregator, SearchAggregator, HomeAggregator, PlayerAggregator,
  // Merge
  SearchMergeEngine,
  // Assemblers
  AnimeDetailAssembler, PlayerAssembler,
  // Strategies
  BannerStrategy,
  // DTOs
  toAnimeCardDTO, toAnimeDetailDTO, toAnimePlayerDTO, toVisualDTO, toEpisodeDTO, toEpisodeListDTO,
  toCharacterDTO, toCharacterListDTO, toScheduleDTO, toThemeDTO, toThemeListDTO,
  // Services
  SearchService, AnimeDetailService, HomeService, ScheduleService, PlayerService,
  MovieDetailService, EpisodeService, ExtractService,
  // Repositories
  AnimeRepository, ScheduleRepository,
};