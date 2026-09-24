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
const { EMBED_TIMEOUT_MS, USER_AGENT } = require('./vidhide.constants');
const { isVidHideUrl, extractVidHideId, normalizeJsEscapes, parseVidHide } = require('./vidhide.parser');

class VidHideResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.VIDHIDE);
    this._http = options.http || createResolverFetcher({ headers: { 'User-Agent': USER_AGENT } });
  }

  canResolve(url) {
    return isVidHideUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractVidHideId(sourceUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('VidHide URL does not contain a video identifier');
    }

    const pageUrl = this._buildPageUrl(sourceUrl, videoId);
    const page = await this._http(pageUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', Referer: pageUrl },
      timeoutMs: EMBED_TIMEOUT_MS,
      responseType: 'text',
    });

    if (page.status >= 400) {
      if (page.status === 404 || page.status === 410) throw new SourceNotFoundError(`VidHide page returned HTTP ${page.status}`);
      if (page.status === 401 || page.status === 403) throw new ResolverBlockedError(`VidHide page returned HTTP ${page.status}`);
      if (page.status === 429) throw new ResolverRateLimitedError(`VidHide page returned HTTP ${page.status}`);
      if (page.status >= 500) throw new UpstreamError(`VidHide page returned HTTP ${page.status}`);
      throw new ResolverParseError(`VidHide page returned unexpected HTTP ${page.status}`);
    }

    const parsed = parseVidHide(page.body || '', pageUrl);
    if (!parsed || !parsed.mediaUrl) {
      throw new ResolverParseError(`Could not extract a VidHide media URL from ${redactUrl(pageUrl)}`);
    }

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: normalizeJsEscapes(parsed.mediaUrl),
      type: parsed.type,
      headers: { ...(parsed.headers || {}), Referer: pageUrl, 'User-Agent': USER_AGENT },
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isVidHideUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported VidHide embed: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _buildPageUrl(sourceUrl, videoId) {
    const parsed = new URL(sourceUrl);
    if (/^\/(embed|e|v|d|f|b|download|file)\//i.test(parsed.pathname)) {
      parsed.pathname = `/v/${videoId}`;
    }
    parsed.hash = '';
    return parsed.toString();
  }
}

module.exports = { VidHideResolver };
