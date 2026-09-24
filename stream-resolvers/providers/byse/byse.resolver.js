'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { createResolverFetcher, parseUrl, redactUrl, detectStreamType } = require('../../core/resolver.utils');
const {
  InvalidSourceUrlError,
  SourceNotFoundError,
  ResolverBlockedError,
  ResolverRateLimitedError,
  ResolverParseError,
  UpstreamError,
  ResolutionFailedError,
} = require('../../core/resolver.errors');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');
const { BYSE_HOST_RE, BYSE_EMBED_PATH_RE, BYSE_API_TIMEOUT_MS, BYSE_USER_AGENT } = require('./byse.constants');
const { decryptPlayback } = require('./byse.crypto');

function isByseEmbedUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return BYSE_HOST_RE.test(parsed.hostname) && BYSE_EMBED_PATH_RE.test(parsed.pathname);
}

function extractByseFileCode(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!BYSE_HOST_RE.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(BYSE_EMBED_PATH_RE);
  return match ? match[1] : null;
}

class ByseResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.BYSE);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': BYSE_USER_AGENT },
    });
  }

  canResolve(url) {
    return isByseEmbedUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const fileCode = extractByseFileCode(sourceUrl);
    const origin = new URL(sourceUrl).origin;

    const apiUrl = `${origin}/api/videos/${encodeURIComponent(fileCode)}`;
    const response = await this._http(apiUrl, {
      headers: {
        Referer: `${origin}/`,
        Origin: origin,
        Accept: 'application/json, text/plain, */*',
      },
      timeoutMs: BYSE_API_TIMEOUT_MS,
      responseType: 'text',
    });

    if (response.status >= 400) {
      throw this._classifyApiStatus(response.status, apiUrl);
    }

    const meta = this._parseApiBody(response.body || '', apiUrl);
    const playback = this._pickPlayback(meta, apiUrl);
    const parsed = this._decryptPlayback(playback, apiUrl);
    const stream = this._pickStream(parsed, apiUrl);

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: stream.url,
      type: stream.type,
      headers: {
        Referer: `${origin}/`,
        Origin: origin,
        'User-Agent': BYSE_USER_AGENT,
      },
      title: meta && typeof meta.title === 'string' ? meta.title : null,
      expiresAt: this._parseExpiresAt(parsed.expires_at),
      metadata: {
        fileCode,
        algorithm: playback.algorithm || null,
        expiresAt: parsed.expires_at || null,
      },
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isByseEmbedUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a Byse embed: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _classifyApiStatus(status, apiUrl) {
    const target = redactUrl(apiUrl);
    if (status === 404 || status === 410) {
      return new SourceNotFoundError(`Byse video returned HTTP ${status}`);
    }
    if (status === 401 || status === 403) {
      return new ResolverBlockedError(`Byse API returned HTTP ${status} for ${target}`);
    }
    if (status === 429) {
      return new ResolverRateLimitedError(`Byse API rate limited for ${target}`);
    }
    if (status >= 500) {
      return new UpstreamError(`Byse API returned HTTP ${status} for ${target}`);
    }
    return new UpstreamError(`Byse API returned unexpected HTTP ${status} for ${target}`);
  }

  _parseApiBody(body, apiUrl) {
    const raw = String(body || '').trim();
    if (!raw) {
      throw new ResolverParseError(`Empty Byse API response for ${redactUrl(apiUrl)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ResolverParseError(`Byse API response is not JSON for ${redactUrl(apiUrl)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ResolverParseError(`Unexpected Byse API response shape for ${redactUrl(apiUrl)}`);
    }
    if (typeof parsed.error === 'string') {
      throw new ResolverParseError(`Byse API error: ${parsed.error}`);
    }
    return parsed;
  }

  _pickPlayback(meta, apiUrl) {
    const playback = meta && meta.playback;
    if (!playback || typeof playback !== 'object') {
      throw new ResolverParseError(`Byse video has no playback envelope for ${redactUrl(apiUrl)}`);
    }
    return playback;
  }

  _decryptPlayback(playback, apiUrl) {
    let decrypted;
    try {
      decrypted = decryptPlayback(playback);
    } catch (err) {
      throw new ResolverParseError(`Byse playback could not be decrypted for ${redactUrl(apiUrl)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(decrypted);
    } catch {
      throw new ResolverParseError(`Decrypted Byse playback is not JSON for ${redactUrl(apiUrl)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ResolverParseError(`Unexpected Byse playback shape for ${redactUrl(apiUrl)}`);
    }
    return parsed;
  }

  _pickStream(parsed, apiUrl) {
    const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    const candidates = sources
      .filter((s) => s && typeof s.url === 'string')
      .map((s) => ({ url: s.url.trim(), height: Number(s.height) || 0, mime: String(s.mime_type || '') }))
      .filter((s) => this._isSupportedUrl(s.url));

    const hls = candidates
      .filter((c) => /\.m3u8($|[?#])/i.test(c.url.split('?')[0]) || /mpegurl/i.test(c.mime))
      .sort((a, b) => b.height - a.height);
    const direct = candidates.filter((c) => !hls.includes(c));

    const chosen = (hls.length > 0 ? hls : direct)[0];
    if (!chosen) {
      throw new ResolutionFailedError(`Byse payload does not expose a playable source for ${redactUrl(apiUrl)}`);
    }
    return { url: chosen.url, type: detectStreamType(chosen.url) };
  }

  _isSupportedUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  }

  _parseExpiresAt(value) {
    if (typeof value !== 'string' || !value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? value : null;
  }
}

module.exports = { ByseResolver, isByseEmbedUrl, extractByseFileCode };