'use strict';

const { UnsupportedProviderError } = require('./resolver.errors');

function defaultResolverList() {
  return [
    new (require('../providers/archive/archive.resolver').ArchiveResolver)(),
    new (require('../providers/mixdrop/mixdrop.resolver').MixDropResolver)(),
    new (require('../providers/streamtape/streamtape.resolver').StreamTapeResolver)(),
    new (require('../providers/filemoon/filemoon.resolver').FileMoonResolver)(),
    new (require('../providers/vidhide/vidhide.resolver').VidHideResolver)(),
    new (require('../providers/streamwish/streamwish.resolver').StreamWishResolver)(),
    new (require('../providers/playmogo/playmogo.resolver').PlaymogoResolver)(),
    new (require('../providers/embed69/embed69.resolver').Embed69Resolver)(),
    new (require('../providers/hglink/hglink.resolver').HglinkResolver)(),
    new (require('../providers/gnulaplayer/gnulaplayer.resolver').GnulaPlayerResolver)(),
    new (require('../providers/rapidvideo/rapidvideo.resolver').RapidVideoResolver)(),
    new (require('../providers/dood/dood.resolver').DoodResolver)(),
    new (require('../providers/voe/voe.resolver').VoeResolver)(),
    new (require('../providers/mp4upload/mp4upload.resolver').Mp4UploadResolver)(),
    new (require('../providers/byse/byse.resolver').ByseResolver)(),
    new (require('../providers/mega/mega.resolver').MegaResolver)(),
    new (require('../providers/uqload/uqload.resolver').UqloadResolver)(),
    new (require('../providers/yourupload/yourupload.resolver').YourUploadResolver)(),
    new (require('../providers/zilla/zilla-hls.resolver').ZillaHlsResolver)(),
    new (require('../providers/nika/nika-hls.resolver').NikaHlsResolver)(),
    new (require('../providers/upnshare/upnshare.resolver').UpnShareResolver)(),
    new (require('../providers/okru/okru.resolver').OKRuResolver)(),
    new (require('../providers/hexload/hexload.resolver').HexloadResolver)(),
    new (require('../providers/savefiles/savefiles.resolver').SaveFilesResolver)(),
    new (require('../providers/ytplay/ytplay.resolver').YtPlayResolver)(),
    new (require('../providers/d23/d23.resolver').D23Resolver)(),
    new (require('../providers/streamhj/streamhj.resolver').StreamHjResolver)(),
    new (require('../providers/vidara/vidara.resolver').VidaraResolver)(),
    new (require('../providers/barmonrey/barmonrey.resolver').BarmonreyResolver)(),
    new (require('../providers/serieslan/serieslan.resolver').SerieslanResolver)(),
    new (require('../providers/primeload/primeload.resolver').PrimeloadResolver)(),
  ];
}

class ResolverRegistry {
  constructor(resolvers = null) {
    this._resolvers = [];
    for (const resolver of resolvers || defaultResolverList()) {
      this.register(resolver);
    }
    this.stats = new Map();
  }

  register(resolver) {
    if (!resolver || typeof resolver.canResolve !== 'function' || typeof resolver.resolve !== 'function') {
      throw new Error('Resolver must implement canResolve() and resolve()');
    }
    this._resolvers.push(resolver);
    return this;
  }

  list() {
    return this._resolvers.slice();
  }

  getResolver(url) {
    return this._resolvers.find((r) => {
      try {
        return r.canResolve(url);
      } catch {
        return false;
      }
    }) || null;
  }

  supports(url) {
    return this.getResolver(url) !== null;
  }

  async resolve(url, options = {}) {
    const resolver = this.getResolver(url);
    if (!resolver) {
      throw new UnsupportedProviderError(url);
    }
    const started = Date.now();
    this._bump(resolver.providerId, 'attempts');
    try {
      const result = await resolver.resolve(url, options);
      this._bump(resolver.providerId, 'success', Date.now() - started);
      return result;
    } catch (err) {
      this._bump(resolver.providerId, 'failure', Date.now() - started, err && err.code);
      throw err;
    }
  }

  statsFor(providerId) {
    return this.stats.get(providerId) || null;
  }

  _bump(providerId, key, delta, extra) {
    if (!providerId) return;
    const entry = this.stats.get(providerId) || { attempts: 0, success: 0, failure: 0, totalDurationMs: 0, lastErrorCode: null };
    if (key === 'attempts') entry.attempts += 1;
    if (key === 'success') entry.success += 1;
    if (key === 'failure') {
      entry.failure += 1;
      entry.lastErrorCode = extra || null;
    }
    if (delta) entry.totalDurationMs += delta;
    this.stats.set(providerId, entry);
  }
}

module.exports = { ResolverRegistry };