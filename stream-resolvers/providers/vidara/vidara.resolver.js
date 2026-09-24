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
  ResolutionFailedError,
} = require('../../core/resolver.errors');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');
const {
  VIDARA_HOST_RE,
  VIDARA_EMBED_PATH_RE,
  VIDARA_API_TIMEOUT_MS,
  VIDARA_USER_AGENT,
} = require('./vidara.constants');

function isVidaraEmbedUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return VIDARA_HOST_RE.test(parsed.hostname) && VIDARA_EMBED_PATH_RE.test(parsed.pathname);
}

function extractVidaraFileCode(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!VIDARA_HOST_RE.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(VIDARA_EMBED_PATH_RE);
  return match ? match[1] : null;
}

function decodeVidaraTitle(title) {
  if (typeof title !== 'string' || !title) return null;
  try {
    const decoded = Buffer.from(title, 'base64').toString('utf8');
    if (decoded && decoded.trim() && /[A-Za-z0-9]/.test(decoded)) {
      return decoded.trim();
    }
  } catch {
    /* ignore */
  }
  return title;
}

class VidaraResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.VIDARA);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': VIDARA_USER_AGENT },
    });
  }

  canResolve(url) {
    return isVidaraEmbedUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const fileCode = extractVidaraFileCode(sourceUrl);

    this._log('[VidaraResolver] URL detected');
    if (!fileCode) {
      throw new InvalidSourceUrlError('Vidara URL does not contain a file code');
    }
    this._log(`[VidaraResolver] File code extracted: ${fileCode}`);

    const origin = new URL(sourceUrl).origin;
    const apiUrl = `${origin}/api/stream`;
    this._log('[VidaraResolver] Requesting stream metadata');

    const response = await this._http(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: `${origin}/e/${fileCode}`,
        Origin: origin,
        Accept: 'application/json',
      },
      data: JSON.stringify({ filecode: fileCode }),
      timeoutMs: VIDARA_API_TIMEOUT_MS,
      responseType: 'text',
    });

    if (response.status >= 400) {
      throw this._classifyApiStatus(response.status, apiUrl);
    }

    const data = this._parseApiBody(response.body || '', apiUrl);
    const streamUrl = this._pickStream(data);
    this._log('[VidaraResolver] Stream detected');

    const origin2 = new URL(streamUrl).origin;

    // Vidara keeps processing some files and answers the manifest request with
    // an HTML/JSON "Video is not ready yet" body instead of a playable m3u8.
    // Surfacing those dead links breaks playback (the player auto-opens the
    // first track). Pre-check the manifest and fail loudly only on a clear
    // "not ready" signal; transient/ambiguous errors are ignored to avoid
    // false negatives. The track is then deprioritized by the enhance flow.
    await this._validateStream(streamUrl, `${origin}/`, origin2);

    this._log('[VidaraResolver] Resolution successful');
    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl,
      type: STREAM_TYPES.HLS,
      headers: {
        Referer: `${origin}/`,
        'User-Agent': VIDARA_USER_AGENT,
        Origin: origin2,
      },
      title: decodeVidaraTitle(data && typeof data.title === 'string' ? data.title : null),
      metadata: {
        filecode: fileCode,
        thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : null,
      },
    });
  }

  _validateInputUrl(url) {    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!VIDARA_HOST_RE.test(parsed.hostname)) {
      throw new InvalidSourceUrlError(`URL is not a Vidara player: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _classifyApiStatus(status, apiUrl) {
    const target = redactUrl(apiUrl);
    if (status === 404 || status === 410) {
      return new SourceNotFoundError(`Vidara returned HTTP ${status}`);
    }
    if (status === 401 || status === 403) {
      return new ResolverBlockedError(`Vidara API returned HTTP ${status} for ${target}`);
    }
    if (status === 429) {
      return new ResolverRateLimitedError(`Vidara API rate limited for ${target}`);
    }
    if (status >= 500) {
      return new UpstreamError(`Vidara API returned HTTP ${status} for ${target}`);
    }
    return new UpstreamError(`Vidara API returned unexpected HTTP ${status} for ${target}`);
  }

  _parseApiBody(body, apiUrl) {
    const raw = String(body || '').trim();
    if (!raw) {
      throw new ResolverParseError(`Empty Vidara API response for ${redactUrl(apiUrl)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ResolverParseError(`Vidara API response is not JSON for ${redactUrl(apiUrl)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ResolverParseError(`Unexpected Vidara payload shape for ${redactUrl(apiUrl)}`);
    }
    if (parsed.error || parsed.success === false) {
      const message = typeof parsed.message === 'string' ? parsed.message : (typeof parsed.error === 'string' ? parsed.error : 'unknown');
      throw new ResolverParseError(`Vidara API error: ${message}`);
    }
    return parsed;
  }

  _pickStream(data) {
    const candidates = [];
    if (typeof data.streaming_url === 'string') candidates.push(data.streaming_url);

    for (const raw of candidates) {
      let source = raw.replace(/\\\//g, '/');
      if (!/\.m3u8($|[?#])/i.test(source.split('?')[0])) {
        continue;
      }
      let parsedStream;
      try {
        parsedStream = new URL(source);
      } catch {
        continue;
      }
      if (parsedStream.protocol !== 'http:' && parsedStream.protocol !== 'https:') continue;
      return parsedStream.toString();
    }

    throw new ResolutionFailedError('Vidara payload does not expose an HLS source URL');
  }

  async _validateStream(streamUrl, referer, origin) {
    try {
      const res = await this._http(streamUrl, {
        method: 'GET',
        headers: {
          'User-Agent': VIDARA_USER_AGENT,
          Referer: referer,
          Origin: origin,
          Accept: '*/*',
        },
        timeoutMs: 10000,
        responseType: 'text',
      });

      if (res.status === 404 || res.status === 410) {
        throw new SourceUnavailableError('Vidara manifest missing (file not ready)');
      }

      const body = String(res.body || '');
      if (!body.trim().startsWith('#EXTM3U')) {
        // Not a playlist. Vidara returns "Video is not ready yet" as an HTML/JSON
        // body for files still processing; that is the only case we exclude on.
        if (/video is not ready/i.test(body) || /\bnot ready\b/i.test(body)) {
          throw new SourceUnavailableError('Vidara file is not ready yet');
        }
        // Ambiguous non-playlist response: keep the track to avoid false negatives.
        this._log('[VidaraResolver] manifest precheck: non-m3u8 response, kept');
        return;
      }
    } catch (err) {
      if (err instanceof SourceUnavailableError) throw err;
      // Network/timeout/5xx: don't exclude — avoid false negatives.
      this._log(`[VidaraResolver] manifest precheck skipped: ${err && err.message}`);
    }
  }

  _log(message) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message);
    }
  }
}

module.exports = { VidaraResolver, isVidaraEmbedUrl, extractVidaraFileCode };
