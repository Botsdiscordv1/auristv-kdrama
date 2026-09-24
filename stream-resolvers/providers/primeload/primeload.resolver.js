'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { parseUrl, redactUrl } = require('../../core/resolver.utils');
const {
  InvalidSourceUrlError,
  SourceNotFoundError,
  SourceUnavailableError,
  ResolverBlockedError,
  ResolverNetworkError,
  ResolutionFailedError,
} = require('../../core/resolver.errors');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');
const {
  PRIMELOAD_HOST_RE,
  PRIMELOAD_EMBED_PATH_RE,
  PRIMELOAD_USER_AGENT,
} = require('./primeload.constants');
const {
  getPrimeloadSession,
  isPrimeloadHostUrl,
  extractEmbedToken,
} = require('./primeload.session');

function isPrimeloadEmbedUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return PRIMELOAD_HOST_RE.test(parsed.hostname) && PRIMELOAD_EMBED_PATH_RE.test(parsed.pathname);
}

function extractPrimeloadToken(url) {
  return extractEmbedToken(url);
}

class PrimeloadResolver extends StreamResolver {
  constructor() {
    super(PROVIDER_IDS.PRIMELOAD);
  }

  canResolve(url) {
    return isPrimeloadEmbedUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const embedToken = extractPrimeloadToken(sourceUrl);
    if (!embedToken) {
      throw new InvalidSourceUrlError('Primeload URL does not contain an embed token');
    }

    this._log('[PrimeloadResolver] authenticating embed ' + embedToken);

    let session;
    try {
      session = await getPrimeloadSession(embedToken);
    } catch (err) {
      throw this._classify(err);
    }

    if (!session.masterUrl) {
      throw new ResolutionFailedError('Primeload session has no master playlist');
    }

    // Mint a fresh master token so the initial manifest / qualities parse works.
    // Subsequent child playlists and segments are authorized by the HLS proxy.
    // pl_embed lets the proxy re-auth after a process restart.
    let streamUrl = session.masterUrl;
    let expiresAt = null;
    try {
      const withEmbed = new URL(session.masterUrl);
      withEmbed.searchParams.set('pl_embed', embedToken);
      const authed = await session.authorizeUrl(withEmbed.toString());
      streamUrl = authed.url;
      // authorizeUrl strips pl_embed — put it back for cold-start recovery
      const finalUrl = new URL(authed.url);
      finalUrl.searchParams.set('pl_embed', embedToken);
      streamUrl = finalUrl.toString();
      expiresAt = authed.expiresAt ? new Date(authed.expiresAt).toISOString() : null;
    } catch (err) {
      this._log(`[PrimeloadResolver] master token skipped: ${err && err.message}`);
      try {
        const fallback = new URL(session.masterUrl);
        fallback.searchParams.set('pl_embed', embedToken);
        streamUrl = fallback.toString();
      } catch {
        streamUrl = session.masterUrl;
      }
    }

    this._log('[PrimeloadResolver] resolved to HLS master');

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl,
      type: STREAM_TYPES.HLS,
      headers: {
        'User-Agent': PRIMELOAD_USER_AGENT,
        Referer: 'https://primeload.co/',
        Origin: 'https://primeload.co',
      },
      expiresAt,
      title: session.title || null,
      metadata: {
        embedToken,
        sessionId: session.sessionId,
        videoId: session.videoId,
        contentId: session.contentId,
        requiresPrimeloadAuth: true,
      },
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isPrimeloadHostUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a Primeload player: ${redactUrl(parsed)}`);
    }
    if (!PRIMELOAD_EMBED_PATH_RE.test(parsed.pathname)) {
      throw new InvalidSourceUrlError(`URL is not a Primeload embed/player path: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _classify(err) {
    if (err && err.code === 'PRIMELOAD_META') {
      return new SourceNotFoundError('Primeload player metadata unavailable');
    }
    if (err && (err.code === 'PRIMELOAD_SESSION' || err.code === 'PRIMELOAD_ATTEST')) {
      return new SourceUnavailableError(`Primeload auth failed: ${err.message}`);
    }
    if (err && err.code === 'PRIMELOAD_WS') {
      return new SourceUnavailableError(err.message);
    }
    if (err && err.response && err.response.status) {
      const status = err.response.status;
      if (status === 404 || status === 410) return new SourceNotFoundError(`Primeload HTTP ${status}`);
      if (status === 401 || status === 403) return new ResolverBlockedError(`Primeload HTTP ${status}`);
    }
    if (err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
      return new ResolverNetworkError(`Primeload timeout: ${err.message}`);
    }
    if (err && err.code && String(err.code).startsWith('PRIMELOAD')) {
      return new SourceUnavailableError(err.message);
    }
    if (err && err.name === 'ResolverError') return err;
    return new ResolutionFailedError(`Primeload resolve failed: ${err && err.message}`);
  }

  _log(message) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message);
    }
  }
}

module.exports = {
  PrimeloadResolver,
  isPrimeloadEmbedUrl,
  extractPrimeloadToken,
};
