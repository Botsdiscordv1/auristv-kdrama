'use strict';

const { StreamResolver } = require('./core/resolver.interface');
const { ResolverResult } = require('./core/resolver.result');
const { ResolverRegistry } = require('./core/resolver.registry');
const errors = require('./core/resolver.errors');
const utils = require('./core/resolver.utils');
const { STREAM_TYPES, PROVIDER_IDS, ERROR_CODES, DEFAULT_OPTIONS } = require('./core/resolver.types');

const { MixDropResolver } = require('./providers/mixdrop/mixdrop.resolver');
const { StreamTapeResolver } = require('./providers/streamtape/streamtape.resolver');
const { FileMoonResolver } = require('./providers/filemoon/filemoon.resolver');
const { VidHideResolver } = require('./providers/vidhide/vidhide.resolver');
const { StreamWishResolver } = require('./providers/streamwish/streamwish.resolver');
const { DoodResolver } = require('./providers/dood/dood.resolver');
const { PlaymogoResolver } = require('./providers/playmogo/playmogo.resolver');
const { Embed69Resolver } = require('./providers/embed69/embed69.resolver');
const { HglinkResolver } = require('./providers/hglink/hglink.resolver');
const { GnulaPlayerResolver } = require('./providers/gnulaplayer/gnulaplayer.resolver');
const { RapidVideoResolver } = require('./providers/rapidvideo/rapidvideo.resolver');
const { VoeResolver } = require('./providers/voe/voe.resolver');
const { Mp4UploadResolver } = require('./providers/mp4upload/mp4upload.resolver');
const { YourUploadResolver } = require('./providers/yourupload/yourupload.resolver');
const { ZillaHlsResolver } = require('./providers/zilla/zilla-hls.resolver');
const { UpnShareResolver } = require('./providers/upnshare/upnshare.resolver');
const { ByseResolver } = require('./providers/byse/byse.resolver');
const { OKRuResolver } = require('./providers/okru/okru.resolver');
const { ArchiveResolver } = require('./providers/archive/archive.resolver');
const { HexloadResolver } = require('./providers/hexload/hexload.resolver');
const { SaveFilesResolver } = require('./providers/savefiles/savefiles.resolver');
const { YtPlayResolver } = require('./providers/ytplay/ytplay.resolver');
const { D23Resolver } = require('./providers/d23/d23.resolver');
const { StreamHjResolver } = require('./providers/streamhj/streamhj.resolver');
const { VidaraResolver } = require('./providers/vidara/vidara.resolver');
const { BarmonreyResolver } = require('./providers/barmonrey/barmonrey.resolver');
const { SerieslanResolver } = require('./providers/serieslan/serieslan.resolver');

const registry = new ResolverRegistry();

async function resolveStream(url, options = {}) {
  return registry.resolve(url, options);
}

module.exports = {
  core: {
    StreamResolver,
    ResolverResult,
    ResolverRegistry,
    errors,
    utils,
    STREAM_TYPES,
    PROVIDER_IDS,
    ERROR_CODES,
    DEFAULT_OPTIONS,
  },
  providers: {
    MixDropResolver,
    StreamTapeResolver,
    FileMoonResolver,
    VidHideResolver,
    StreamWishResolver,
    DoodResolver,
    VoeResolver,
    Mp4UploadResolver,
    YourUploadResolver,
    ZillaHlsResolver,
    UpnShareResolver,
    ByseResolver,
    OKRuResolver,
    ArchiveResolver,
    HexloadResolver,
    SaveFilesResolver,
    YtPlayResolver,
    D23Resolver,
    StreamHjResolver,
    VidaraResolver,
    BarmonreyResolver,
    SerieslanResolver,
    PlaymogoResolver,
    Embed69Resolver,
    HglinkResolver,
    RapidVideoResolver,
    GnulaPlayerResolver,
  },
  registry,
  resolveStream,
};