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
  YTPLAY_HOST_RE,
  PLAYER_FRAGMENT_RE,
  USER_AGENT,
  API_TIMEOUT_MS,
} = require('./ytplay.constants');
const { decryptPayload } = require('./ytplay.crypto');

function isYtPlayPlayerUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    new URL(url);
  } catch {
    return false;
  }
  return YTPLAY_HOST_RE.test(new URL(url).hostname);
}

function extractVideoHash(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(PLAYER_FRAGMENT_RE);
  return match ? match[1] : null;
}

class YtPlayResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.YTPLAY);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  canResolve(url) {
    return isYtPlayPlayerUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoHash = extractVideoHash(sourceUrl);

    this._log('[YTPlayResolver] URL detected');
    if (!videoHash) {
      throw new InvalidSourceUrlError('YTPlay URL does not contain a video hash');
    }
    this._log(`[YTPlayResolver] Hash extracted: ${videoHash}`);

    const origin = new URL(sourceUrl).origin;
    const apiUrl = `${origin}/api/v1/video?id=${encodeURIComponent(videoHash)}&w=1280&h=720&r=`;
    this._log('[YTPlayResolver] Resolving reference');

    const response = await this._http(apiUrl, {
      headers: {
        Accept: 'application/octet-stream, */*',
      },
      timeoutMs: API_TIMEOUT_MS,
      responseType: 'text',
    });

    if (response.status >= 400) {
      throw this._classifyApiStatus(response.status, apiUrl);
    }

    const payload = this._parseApiBody(response.body || '', apiUrl);
    this._log('[YTPlayResolver] Metadata received');

    const streamUrl = this._pickStream(payload, origin);
    this._log('[YTPlayResolver] Stream detected');

    this._log('[YTPlayResolver] Resolution successful');
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
    if (!YTPLAY_HOST_RE.test(parsed.hostname)) {
      throw new InvalidSourceUrlError(`URL is not a YTPlay player: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _classifyApiStatus(status, apiUrl) {
    const target = redactUrl(apiUrl);
    if (status === 404 || status === 410) {
      return new SourceNotFoundError(`YTPlay video returned HTTP ${status}`);
    }
    if (status === 401 || status === 403) {
      return new ResolverBlockedError(`YTPlay API returned HTTP ${status} for ${target}`);
    }
    if (status === 429) {
      return new ResolverRateLimitedError(`YTPlay API rate limited for ${target}`);
    }
    if (status >= 500) {
      return new UpstreamError(`YTPlay API returned HTTP ${status} for ${target}`);
    }
    return new UpstreamError(`YTPlay API returned unexpected HTTP ${status} for ${target}`);
  }

  _parseApiBody(body, apiUrl) {
    const raw = String(body || '').trim();
    if (!raw) {
      throw new ResolverParseError(`Empty YTPlay API response for ${redactUrl(apiUrl)}`);
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
        throw new ResolverParseError(`YTPlay API error: ${json.error}`);
      }
    }

    let decrypted;
    try {
      decrypted = decryptPayload(raw, { requireJson: true });
    } catch (err) {
      throw new ResolverParseError(`YTPlay payload could not be decrypted for ${redactUrl(apiUrl)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(decrypted);
    } catch {
      throw new ResolverParseError(`Decrypted YTPlay payload is not JSON for ${redactUrl(apiUrl)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ResolverParseError(`Unexpected YTPlay payload shape for ${redactUrl(apiUrl)}`);
    }
    return parsed;
  }

  _pickStream(payload, origin) {
    // Prefer the signed native playlist (cfNative) when present; fall back to
    // the plain source URL otherwise.
    const candidates = [];
    if (payload && typeof payload.cfNative === 'string') candidates.push(payload.cfNative);
    if (payload && typeof payload.source === 'string') candidates.push(payload.source);

    for (const raw of candidates) {
      let source = raw.replace(/\\\//g, '/');
      if (!/\.m3u8($|[?#])/i.test(source.split('?')[0])) continue;

      let parsedStream;
      try {
        parsedStream = new URL(source, `${origin}/`);
      } catch {
        continue;
      }
      if (parsedStream.protocol !== 'http:' && parsedStream.protocol !== 'https:') continue;
      return parsedStream.toString();
    }

    throw new ResolutionFailedError('YTPlay payload does not expose an HLS source URL');
  }

  _log(message) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message);
    }
  }
}

module.exports = { YtPlayResolver, isYtPlayPlayerUrl, extractVideoHash };
