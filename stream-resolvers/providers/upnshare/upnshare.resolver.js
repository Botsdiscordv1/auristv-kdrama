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
  ResolutionFailedError,
} = require('../../core/resolver.errors');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');
const {
  PLAYER_URL_RE,
  PLAYER_FRAGMENT_RE,
  USER_AGENT,
  API_TIMEOUT_MS,
} = require('./upnshare.constants');
const { decryptPayload } = require('./upnshare.crypto');

function isUpnSharePlayerUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    new URL(url);
  } catch {
    return false;
  }
  return PLAYER_URL_RE.test(url);
}

function extractVideoHash(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(PLAYER_FRAGMENT_RE);
  return match ? match[1] : null;
}

class UpnShareResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.UPNSHARE);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  canResolve(url) {
    return isUpnSharePlayerUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractVideoHash(sourceUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('UPnShare URL does not contain a video hash');
    }

    const origin = new URL(sourceUrl).origin;
    const apiUrl = `${origin}/api/v1/video?id=${encodeURIComponent(videoId)}&w=1280&h=720&r=${origin}/`;
    const response = await this._http(apiUrl, {
      headers: {
        Referer: `${origin}/`,
        Origin: origin,
        Accept: 'application/octet-stream, */*',
      },
      timeoutMs: API_TIMEOUT_MS,
      responseType: 'text',
    });

    if (response.status >= 400) {
      throw this._classifyApiStatus(response.status, apiUrl);
    }

    const payload = this._parseApiBody(response.body || '', apiUrl);
    const streamUrl = this._pickStream(payload, origin);

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl,
      type: STREAM_TYPES.HLS,
      headers: {
        Referer: `${origin}/`,
        'User-Agent': USER_AGENT,
      },
      title: payload && typeof payload.title === 'string' ? payload.title : null,
      metadata: {
        cfNative: payload.cfNative,
        cf: payload.cf,
        hasCfNative: Boolean(payload.cfNative),
      },
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isUpnSharePlayerUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a UPnShare player: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _classifyApiStatus(status, apiUrl) {
    const target = redactUrl(apiUrl);
    if (status === 404 || status === 410) {
      return new SourceNotFoundError(`UPnShare video returned HTTP ${status}`);
    }
    if (status === 401 || status === 403) {
      return new ResolverBlockedError(`UPnShare API returned HTTP ${status} for ${target}`);
    }
    if (status === 429) {
      return new ResolverRateLimitedError(`UPnShare API rate limited for ${target}`);
    }
    if (status >= 500) {
      return new UpstreamError(`UPnShare API returned HTTP ${status} for ${target}`);
    }
    return new UpstreamError(`UPnShare API returned unexpected HTTP ${status} for ${target}`);
  }

  _parseApiBody(body, apiUrl) {
    const raw = String(body || '').trim();
    if (!raw) {
      throw new ResolverParseError(`Empty UPnShare API response for ${redactUrl(apiUrl)}`);
    }

    // Some deployments answer a plain-text error object on failure.
    if (raw.startsWith('{')) {
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
      if (json && typeof json.error === 'string') {
        throw new ResolverParseError(`UPnShare API error: ${json.error}`);
      }
    }

    let decrypted;
    try {
      decrypted = decryptPayload(raw, { requireJson: true });
    } catch (err) {
      throw new ResolverParseError(`UPnShare payload could not be decrypted for ${redactUrl(apiUrl)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(decrypted);
    } catch {
      throw new ResolverParseError(`Decrypted UPnShare payload is not JSON for ${redactUrl(apiUrl)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ResolverParseError(`Unexpected UPnShare payload shape for ${redactUrl(apiUrl)}`);
    }
    return parsed;
  }

  _pickStream(payload, origin) {
    let source = payload && payload.source;
    if (source && typeof source === 'string') source = source.replace(/\\\//g, '/');
    if (!source || !/\.m3u8($|[?#])/i.test(source.split('?')[0])) {
      throw new ResolutionFailedError('UPnShare payload does not expose an HLS source URL');
    }
    let streamUrl;
    let parsedStream;
    try {
      parsedStream = new URL(source, `${origin}/`);
      streamUrl = parsedStream.toString();
    } catch {
      throw new ResolutionFailedError('UPnShare exposed a malformed source URL');
    }
    if (parsedStream.protocol !== 'http:' && parsedStream.protocol !== 'https:') {
      throw new ResolutionFailedError('UPnShare source URL uses an unsupported protocol');
    }
    return streamUrl;
  }
}

module.exports = { UpnShareResolver, isUpnSharePlayerUrl, extractVideoHash };