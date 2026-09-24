'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const {
  InvalidSourceUrlError,
  ResolverBlockedError,
  ResolverParseError,
  ResolverRateLimitedError,
  SourceNotFoundError,
  UpstreamError,
} = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { createResolverFetcher, parseUrl, redactUrl, detectStreamType } = require('../../core/resolver.utils');
const { MP4UPLOAD_TIMEOUT_MS, MP4UPLOAD_USER_AGENT } = require('./mp4upload.constants');
const { isMp4UploadUrl, extractMp4UploadId, toMp4UploadEmbedUrl } = require('./mp4upload.utils');
const { parseMp4Upload } = require('./mp4upload.parser');

class Mp4UploadResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.MP4UPLOAD);
    this._http = options.http || createResolverFetcher({ headers: { 'User-Agent': MP4UPLOAD_USER_AGENT } });
  }

  canResolve(url) {
    return isMp4UploadUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const embedUrl = this._resolveEmbedUrl(sourceUrl);
    const videoId = extractMp4UploadId(embedUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('MP4Upload URL does not contain a video identifier');
    }

    let response;
    try {
      response = await this._http(embedUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          Referer: `${new URL(embedUrl).origin}/`,
        },
        timeoutMs: MP4UPLOAD_TIMEOUT_MS,
        responseType: 'text',
      });
    } catch (error) {
      throw error;
    }

    if (response.status >= 400) {
      this._throwForStatus(response.status, `MP4Upload page returned HTTP ${response.status}`);
    }

    const parsed = parseMp4Upload(response.body || '', response.finalUrl || embedUrl);
    if (!parsed || !parsed.mediaUrl) {
      throw new ResolverParseError(`Could not extract MP4Upload media URL from ${redactUrl(embedUrl)}`);
    }

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: parsed.mediaUrl,
      type: parsed.type || detectStreamType(parsed.mediaUrl),
      headers: parsed.headers || {},
    });
  }

  _resolveEmbedUrl(inputUrl) {
    const url = new URL(inputUrl);
    url.hash = '';
    url.search = '';
    if (/^\/embed-[a-zA-Z0-9]+\.html$/.test(url.pathname) || /^\/[a-zA-Z0-9]+\.html$/.test(url.pathname)) {
      return url.toString();
    }
    return toMp4UploadEmbedUrl(url.toString());
  }

  _throwForStatus(status, message) {
    if (status === 404 || status === 410) throw new SourceNotFoundError(message);
    if (status === 401 || status === 403) throw new ResolverBlockedError(message);
    if (status === 429) throw new ResolverRateLimitedError(message);
    if (status >= 500) throw new UpstreamError(message);
    throw new ResolverParseError(message);
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isMp4UploadUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported MP4Upload embed: ${redactUrl(parsed)}`);
    }
    const normalized = new URL(parsed.toString());
    normalized.hash = '';
    return normalized.toString();
  }
}

module.exports = { Mp4UploadResolver };