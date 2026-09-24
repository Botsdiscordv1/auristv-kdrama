'use strict';

const { StreamResolver } = require('../../core/resolver.interface');
const {
  InvalidSourceUrlError,
  ResolverParseError,
  ResolverBlockedError,
  ResolverRateLimitedError,
  SourceNotFoundError,
  UpstreamError,
  ResolutionFailedError,
  UnsupportedMediaError,
} = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { createResolverFetcher, parseUrl, detectStreamType } = require('../../core/resolver.utils');
const {
  MEGA_API_BASE,
  MEGA_API_HOST,
  MEGA_TIMEOUT_MS,
  MEGA_USER_AGENT,
  MEGA_MAX_API_REQUESTS,
  MEGA_MAX_REDIRECTS,
  MEGA_SUPPORTED_VIDEO_EXT_RE,
} = require('./mega.constants');
const { isMegaUrl, parseMegaUrl } = require('./mega.parser');
const { decryptMetadata } = require('./mega.crypto');

const API_ERROR_NOT_FOUND = -9;
const API_ERROR_EAGAIN = -3;
const API_ERROR_RATELIMIT = -4;
const API_ERROR_BLOCKED = -16;
const API_ERROR_OVERQUOTA = -17;
const API_ERROR_EARGS = -2;

class MegaResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.MEGA);
    this._http = options.http || createResolverFetcher({ headers: { 'User-Agent': MEGA_USER_AGENT } });
    this._seq = 0;
  }

  canResolve(url) {
    return isMegaUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const parsed = parseMegaUrl(sourceUrl);
    if (!parsed) {
      throw new ResolutionFailedError('Could not parse MEGA URL');
    }
    if (parsed.type !== 'file') {
      throw new ResolutionFailedError('MEGA folder URLs are not supported by MegaResolver');
    }
    if (!parsed.fileId || !parsed.key) {
      throw new ResolutionFailedError('Invalid MEGA file key');
    }

    const metadata = await this._getMetadata(parsed);
    if (!metadata) {
      throw new ResolutionFailedError('Could not obtain MEGA metadata');
    }

    const attrs = decryptMetadata(metadata.attributes, parsed.key);
    if (!attrs || !attrs.n) {
      throw new ResolutionFailedError('Could not decrypt MEGA metadata');
    }
    const fileName = attrs.n;

    if (!MEGA_SUPPORTED_VIDEO_EXT_RE.test(fileName)) {
      throw new UnsupportedMediaError(`${fileName} is not a supported MEGA video file`);
    }

    const mediaInfo = await this._resolveMedia(parsed, metadata);
    if (!mediaInfo || !mediaInfo.url) {
      throw new ResolutionFailedError('Could not resolve MEGA media URL');
    }

    const streamType = detectStreamType(fileName);

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: mediaInfo.url,
      type: streamType === 'unknown' ? 'mp4' : streamType,
      headers: mediaInfo.headers || {},
      title: fileName,
    });
  }

  async _apiRequest(payload, apiCall) {
    this._seq = (this._seq + 1) % 10000;
    const apiUrl = `${MEGA_API_BASE}/cs?id=${this._seq}`;

    let response;
    try {
      response = await this._http(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify([payload]),
        timeoutMs: MEGA_TIMEOUT_MS,
        responseType: 'text',
      });
    } catch (error) {
      throw error;
    }

    if (response.status >= 400) {
      this._throwForStatus(response.status, `MEGA API returned HTTP ${response.status}`);
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(response.body || '');
    } catch {
      throw new ResolverParseError('MEGA API returned a non-JSON response');
    }

    const result = Array.isArray(parsedBody) ? parsedBody[0] : parsedBody;
    if (typeof result === 'number') {
      this._throwForApiError(result, apiCall);
    }
    if (!result || typeof result !== 'object') {
      throw new ResolverParseError('MEGA API returned an empty response');
    }
    return result;
  }

  async _getMetadata(parsed) {
    const result = await this._apiRequest({ a: 'g', p: parsed.fileId }, 'getMetadata');
    const attributes = result.at;
    return {
      size: typeof result.s === 'number' ? result.s : null,
      attributes: typeof attributes === 'string' && attributes.length > 0 ? attributes : null,
    };
  }

  async _resolveMedia(parsed, metadata) {
    const result = await this._apiRequest({ a: 'g', g: 1, p: parsed.fileId }, 'resolveMedia');
    const url = result.g;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new ResolutionFailedError('MEGA did not return a usable temporary URL');
    }
    return { url, headers: {} };
  }

  _throwForApiError(code, callName) {
    if (code === API_ERROR_NOT_FOUND) {
      throw new SourceNotFoundError('MEGA file not found');
    }
    if (code === API_ERROR_RATELIMIT || code === API_ERROR_OVERQUOTA) {
      throw new ResolverRateLimitedError(`MEGA API rate limited during ${callName}`);
    }
    if (code === API_ERROR_BLOCKED) {
      throw new ResolverBlockedError(`MEGA access blocked during ${callName}`);
    }
    if (code === API_ERROR_EAGAIN) {
      throw new UpstreamError(`MEGA API temporarily unavailable during ${callName}`);
    }
    if (code === API_ERROR_EARGS) {
      throw new InvalidSourceUrlError(`MEGA API rejected the request during ${callName}`);
    }
    throw new UpstreamError(`MEGA API error ${code} during ${callName}`);
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
    if (!isMegaUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported MEGA link: ${this._redactKeyedUrl(parsed)}`);
    }
    const normalized = new URL(parsed.toString());
    return normalized.toString();
  }

  _redactKeyedUrl(url) {
    const u = new URL(url.toString());
    if (u.hash) {
      u.hash = '#[REDACTED]';
    }
    return (u.username || u.password) ? `${u.protocol}//${u.host}${u.pathname}${u.hash}` : u.toString();
  }
}

module.exports = {
  MegaResolver,
  MEGA_API_HOST,
  MEGA_MAX_API_REQUESTS,
  MEGA_MAX_REDIRECTS,
  API_ERROR_NOT_FOUND,
};