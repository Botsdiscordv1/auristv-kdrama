const { AnimeSummary } = require('./models/AnimeSummary');
const { AnimeDetail } = require('./models/AnimeDetail');
const { Episode } = require('./models/Episode');
const { AnimeSource } = require('./models/AnimeSource');
const { BannerInfo } = require('./models/BannerInfo');

const { TMDBProvider } = require('./providers/tmdb/tmdb.provider');
const { AnimeAV1Provider } = require('./providers/animeav1/animeav1.provider');
const { AnimeFLVProvider } = require('./providers/animeflv/animeflv.provider');
const { JKAnimeProvider } = require('./providers/jkanime/jkanime.provider');
const { AniyaeProvider } = require('./providers/aniyae/aniyae.provider');
const { registry } = require('./providers/registry/ProviderRegistry');

const {
  VisualResolver, EpisodeResolver,
  SearchResolver, RecommendationResolver, BannerResolver,
} = require('./resolvers');

const { SearchAggregator } = require('./aggregators/SearchAggregator');
const { BannerStrategy } = require('./strategy/BannerStrategy');
const { SearchMergeEngine } = require('./merge/SearchMergeEngine');
const { AnimeDetailAssembler, PlayerAssembler } = require('./assemblers');

const {
  toAnimeCardDTO, toAnimeDetailDTO, toAnimePlayerDTO, toVisualDTO, toEpisodeDTO, toEpisodeListDTO,
  toCharacterDTO, toCharacterListDTO, toScheduleDTO, toThemeDTO, toThemeListDTO,
} = require('./dto');

const {
  SearchService, PlayerService,
  MovieDetailService, EpisodeService, ExtractService,
} = require('./services');

module.exports = {
  // Models
  AnimeSummary, AnimeDetail, Episode, AnimeSource, BannerInfo,
  // Providers
  TMDBProvider, AnimeAV1Provider, AnimeFLVProvider, JKAnimeProvider, AniyaeProvider,
  // Registry
  registry,
  // Resolvers
  VisualResolver, EpisodeResolver, SearchResolver, RecommendationResolver, BannerResolver,
  // Aggregators
  SearchAggregator,
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
  SearchService, PlayerService, MovieDetailService, EpisodeService, ExtractService,
};
