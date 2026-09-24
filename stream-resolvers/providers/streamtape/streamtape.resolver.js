'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { createResolverFetcher, parseUrl, redactUrl } = require('../../core/resolver.utils');
const {
  InvalidSourceUrlError,
  SourceNotFoundError,
  ResolverParseError,
  ResolverBlockedError,
  ResolverRateLimitedError,
  UpstreamError,
} = require('../../core/resolver.errors');
const { PROVIDER_IDS } = require('../../core/resolver.types');

const { EMBED_TIMEOUT_MS, USER_AGENT } = require('./streamtape.constants');

const {
  parseStreamTape,
  isStreamTapeUrl,
  extractStreamTapeId,
} = require('./streamtape.parser');

class StreamTapeResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.STREAMTAPE);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  canResolve(url) {
    return isStreamTapeUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractStreamTapeId(sourceUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('StreamTape URL does not contain a video identifier');
    }

    const pageUrl = this._buildPageUrl(sourceUrl, videoId);
    const page = await this._http(pageUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      timeoutMs: EMBED_TIMEOUT_MS,
      responseType: 'text',
    });

    if (page.status >= 400) {
      if (page.status === 404 || page.status === 410) {
        throw new SourceNotFoundError(`StreamTape page returned HTTP ${page.status}`);
      }
      if (page.status === 401 || page.status === 403) {
        throw new ResolverBlockedError(`StreamTape page returned HTTP ${page.status}`);
      }
      if (page.status === 429) {
        throw new ResolverRateLimitedError(`StreamTape page returned HTTP ${page.status}`);
      }
      if (page.status >= 500) {
        throw new UpstreamError(`StreamTape page returned HTTP ${page.status}`);
      }
      throw new ResolverParseError(`StreamTape page returned unexpected HTTP ${page.status}`);
    }

    const parsed = parseStreamTape(page.body || '', pageUrl);
    if (!parsed || !parsed.mediaUrl) {
      throw new ResolverParseError(`Could not extract a StreamTape media URL from ${redactUrl(pageUrl)}`);
    }

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: parsed.mediaUrl,
      type: parsed.type,
      headers: parsed.headers || {},
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isStreamTapeUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported StreamTape page: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _buildPageUrl(sourceUrl, videoId) {
    const parsed = new URL(sourceUrl);
    parsed.pathname = `/v/${videoId}`;
    parsed.hash = '';
    return parsed.toString();
  }
}

module.exports = { StreamTapeResolver };