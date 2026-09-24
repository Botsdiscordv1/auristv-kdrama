'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const {
  InvalidSourceUrlError,
  SourceNotFoundError,
  ResolverParseError,
  ResolverBlockedError,
  ResolverRateLimitedError,
  UpstreamError,
} = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { createResolverFetcher, parseUrl, redactUrl } = require('../../core/resolver.utils');
const { EMBED_TIMEOUT_MS, USER_AGENT } = require('./streamwish.constants');
const { isStreamWishUrl, extractStreamWishId, parseStreamWish } = require('./streamwish.parser');

class StreamWishResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.STREAMWISH);
    this._http = options.http || createResolverFetcher({ headers: { 'User-Agent': USER_AGENT } });
  }

  canResolve(url) {
    return isStreamWishUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractStreamWishId(sourceUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('StreamWish URL does not contain a video identifier');
    }

    const pageUrl = this._buildPageUrl(sourceUrl, videoId);
    const page = await this._http(pageUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', Referer: pageUrl },
      timeoutMs: EMBED_TIMEOUT_MS,
      responseType: 'text',
    });

    if (page.status >= 400) {
      if (page.status === 404 || page.status === 410) throw new SourceNotFoundError(`StreamWish page returned HTTP ${page.status}`);
      if (page.status === 401 || page.status === 403) throw new ResolverBlockedError(`StreamWish page returned HTTP ${page.status}`);
      if (page.status === 429) throw new ResolverRateLimitedError(`StreamWish page returned HTTP ${page.status}`);
      if (page.status >= 500) throw new UpstreamError(`StreamWish page returned HTTP ${page.status}`);
      throw new ResolverParseError(`StreamWish page returned unexpected HTTP ${page.status}`);
    }

    const parsed = parseStreamWish(page.body || '', pageUrl);
    if (!parsed || !parsed.mediaUrl) {
      throw new ResolverParseError(`Could not extract a StreamWish media URL from ${redactUrl(pageUrl)}`);
    }

    // Streamwish CDN (centaurus) ata el token del master.m3u8 a la cookie de
    // sesión que fija la página del embed. El proxy HLS no la tendría y recibe
    // 403/500 ("Proxy error"). Capturamos el Set-Cookie y lo reenviamos.
    const setCookie = page.headers && page.headers['set-cookie'];
    const cookie = Array.isArray(setCookie)
      ? setCookie.map((c) => c.split(';')[0]).join('; ')
      : (setCookie ? String(setCookie).split(';')[0] : '');

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: parsed.mediaUrl,
      type: parsed.type,
      headers: {
        ...(parsed.headers || {}),
        Referer: pageUrl,
        'User-Agent': USER_AGENT,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isStreamWishUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported StreamWish embed: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _buildPageUrl(sourceUrl, videoId) {
    const parsed = new URL(sourceUrl);
    parsed.pathname = `/${videoId}`;
    parsed.hash = '';
    return parsed.toString();
  }
}

module.exports = { StreamWishResolver };
