'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { createResolverFetcher, parseUrl, redactUrl } = require('../../core/resolver.utils');
const {
  InvalidSourceUrlError,
  SourceNotFoundError,
  SourceUnavailableError,
  ResolverParseError,
  ResolverBlockedError,
  ResolverRateLimitedError,
  UpstreamError,
  StreamInvalidError,
} = require('../../core/resolver.errors');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');

const {
  SITE_ORIGIN,
  EMBED_TIMEOUT_MS,
  CDN_PROBE_TIMEOUT_MS,
  USER_AGENT,
} = require('./mixdrop.constants');

const {
  parseMixDrop,
  isMixDropUrl,
  extractVideoId,
  isMixDropCdnHost,
} = require('./mixdrop.parser');

class MixDropResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.MIXDROP);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  canResolve(url) {
    return isMixDropUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractVideoId(sourceUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('MixDrop URL does not contain a video identifier');
    }

    const embedUrl = `${new URL(sourceUrl).origin}/e/${videoId}`;
    const page = await this._http(embedUrl, {
      headers: { Referer: SITE_ORIGIN, Accept: 'text/html,application/xhtml+xml' },
      timeoutMs: EMBED_TIMEOUT_MS,
      responseType: 'text',
    });

    if (page.status >= 400) {
      if (page.status === 404 || page.status === 410) {
        throw new SourceNotFoundError(`MixDrop embed returned HTTP ${page.status}`);
      }
      if (page.status === 401 || page.status === 403) {
        throw new ResolverBlockedError(`MixDrop embed returned HTTP ${page.status}`);
      }
      if (page.status === 429) {
        throw new ResolverRateLimitedError(`MixDrop embed returned HTTP ${page.status}`);
      }
      if (page.status >= 500) {
        throw new UpstreamError(`MixDrop embed returned HTTP ${page.status}`);
      }
      throw new ResolverParseError(`MixDrop embed returned unexpected HTTP ${page.status}`);
    }

    const resolved = this._resolveStreamUrl(page.body || '', embedUrl);
    await this._probeCdn(resolved.streamUrl);

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: resolved.streamUrl,
      type: STREAM_TYPES.MP4,
      headers: {
        Referer: SITE_ORIGIN,
        'User-Agent': USER_AGENT,
      },
      title: resolved.title,
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isMixDropUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported MixDrop embed: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _resolveStreamUrl(body, embedUrl) {
    const parsed = parseMixDrop(body, embedUrl);
    if (!parsed || !parsed.mediaUrl) {
      throw new ResolverParseError(`Could not extract a MixDrop media URL from ${redactUrl(embedUrl)}`);
    }
    let cdn;
    try {
      cdn = new URL(parsed.mediaUrl);
    } catch {
      throw new InvalidSourceUrlError(`Malformed CDN URL extracted from ${redactUrl(embedUrl)}`);
    }
    if (cdn.protocol !== 'https:' && cdn.protocol !== 'http:') {
      throw new InvalidSourceUrlError('Extracted MixDrop CDN URL uses an unsupported protocol');
    }
    if (!isMixDropCdnHost(cdn.hostname)) {
      throw new ResolverParseError(`Unexpected MixDrop CDN host: ${cdn.hostname}`);
    }
    return { streamUrl: cdn.toString(), title: parsed.title || null };
  }

  async _probeCdn(streamUrl) {
    const probe = await this._http(streamUrl, {
      method: 'GET',
      headers: { Referer: SITE_ORIGIN, Range: 'bytes=0-15' },
      timeoutMs: CDN_PROBE_TIMEOUT_MS,
      responseType: 'arraybuffer',
    });
    if (probe.status !== 206) {
      throw new SourceUnavailableError(`MixDrop CDN probe failed (HTTP ${probe.status})`);
    }
    const bytes = Buffer.isBuffer(probe.body) ? probe.body : Buffer.from(probe.body || []);
    if (bytes.length < 8 || bytes.slice(4, 8).toString('binary') !== 'ftyp') {
      throw new StreamInvalidError('MixDrop CDN probe did not return an MP4 container');
    }
    return probe;
  }
}

module.exports = { MixDropResolver };