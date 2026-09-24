'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { createResolverFetcher, parseUrl, redactUrl, detectStreamType } = require('../../core/resolver.utils');
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
  OKRU_HOSTNAME_RE,
  OKRU_VIDEOEMBED_PATH_RE,
  OKRU_VIDEO_PATH_RE,
  OKRU_PAGE_TIMEOUT_MS,
  OKRU_MASTER_TIMEOUT_MS,
  OKRU_USER_AGENT,
  OKRU_PAGE_HEADERS,
  OKRU_UNAVAILABLE_MARKERS,
  OKRU_PLAYABLE_QUALITY_ORDER,
} = require('./okru.constants');

const DATA_OPTIONS_RE = /data-options="([^"]+)"/;

function isOkRuUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return OKRU_HOSTNAME_RE.test(parsed.hostname);
}

function isOkRuPlayerUrl(url) {
  if (!isOkRuUrl(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return OKRU_VIDEOEMBED_PATH_RE.test(parsed.pathname) || OKRU_VIDEO_PATH_RE.test(parsed.pathname);
}

function extractOkRuVideoId(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!OKRU_HOSTNAME_RE.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(OKRU_VIDEOEMBED_PATH_RE) || parsed.pathname.match(OKRU_VIDEO_PATH_RE);
  return match ? match[1] : null;
}

// The embed page ships the player payload as an HTML-escaped JSON string inside
// `data-options`. The escaping uses &quot;/&amp;/&lt;/&gt; plus double-escaped
// unicode sequences (\\\\uXXXX) for characters like `&`. Decode that envelope
// into the raw JSON text, then JSON.parse it.
function decodeDataOptions(raw) {
  const unwrapped = (raw.match(/^\"(.*)\"$/) || [null, raw])[1];
  let dec = unwrapped
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  dec = dec.replace(/\\\\u([0-9a-fA-F]{4})/g, (_, hex) => `\\u${hex}`);
  return dec;
}

function findMetadata(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const flashvars = payload.flashvars;
  const metadata = (flashvars && typeof flashvars === 'object' && flashvars.metadata) || null;
  if (typeof metadata === 'string' && metadata.trim()) {
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  if (metadata && typeof metadata === 'object') {
    return metadata;
  }
  return null;
}

function pickHlsMaster(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const master = meta.hlsManifestUrl || meta.ondemandHls || null;
  if (typeof master === 'string' && master.startsWith('http')) return master;
  return null;
}

function parseMasterVariants(masterBody, masterUrl) {
  const lines = String(masterBody || '').split('\n');
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const attrs = {};
    for (const part of line.replace(/^#EXT-X-STREAM-INF:\s*/, '').split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      attrs[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    }
    const target = (lines[i + 1] || '').trim();
    if (!target || target.startsWith('#')) continue;
    variants.push({
      url: new URL(target, masterUrl).toString(),
      quality: attrs.QUALITY || null,
      resolution: attrs.RESOLUTION || null,
      height: Number((attrs.RESOLUTION || '').split('x')[1]) || 0,
      bandwidth: Number(attrs.BANDWIDTH) || 0,
    });
  }
  return variants;
}

function pickBestVariant(variants) {
  if (variants.length === 0) return null;
  return variants.slice().sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth)[0];
}

function pickDirectVideo(meta) {
  const videos = Array.isArray(meta && meta.videos) ? meta.videos : null;
  if (!videos || videos.length === 0) return null;
  const ranked = videos
    .filter((v) => v && typeof v.url === 'string' && v.url.startsWith('http'))
    .map((v) => ({ video: v, rank: OKRU_PLAYABLE_QUALITY_ORDER.indexOf(String(v.name || '').toLowerCase()) }))
    .sort((a, b) => {
      const av = a.rank === -1 ? Number.MAX_SAFE_INTEGER : a.rank;
      const bv = b.rank === -1 ? Number.MAX_SAFE_INTEGER : b.rank;
      return av - bv;
    });
  return ranked.length > 0 ? ranked[0].video : null;
}

function pickExpiresAt(hlsUrl) {
  try {
    const parsed = new URL(hlsUrl);
    const raw = parsed.searchParams.get('expires');
    const value = Number(raw);
    // OK.ru uses millisecond epoch timestamps in the expires param.
    if (Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  } catch {
    return null;
  }
  return null;
}

class OKRuResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.OKRU);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': OKRU_USER_AGENT },
    });
  }

  canResolve(url) {
    return isOkRuPlayerUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractOkRuVideoId(sourceUrl);
    const origin = new URL(sourceUrl).origin;

    this._log(`[OKRuResolver] URL detected: ${redactUrl(sourceUrl)}`);
    this._log(`[OKRuResolver] Video ID: ${videoId}`);

    const pageUrl = `${origin}/videoembed/${encodeURIComponent(videoId)}`;
    this._log(`[OKRuResolver] Fetching public video metadata: ${redactUrl(pageUrl)}`);

    const response = await this._http(pageUrl, {
      headers: OKRU_PAGE_HEADERS,
      timeoutMs: OKRU_PAGE_TIMEOUT_MS,
      responseType: 'text',
    });

    if (response.status >= 400) {
      throw this._classifyPageStatus(response.status, pageUrl);
    }

    const body = String(response.body || '');
    if (OKRU_UNAVAILABLE_MARKERS.some((marker) => body.includes(marker))) {
      throw new SourceUnavailableError('OK.ru video is unavailable or was removed by its owner');
    }

    const payload = this._parsePlayerPayload(body, pageUrl);
    const meta = findMetadata(payload);
    if (!meta || typeof meta !== 'object') {
      throw new ResolverParseError(`OK.ru video has no public metadata for ${redactUrl(pageUrl)}`);
    }

    this._log('[OKRuResolver] Stream variants detected');

    const hlsMaster = pickHlsMaster(meta);
    if (hlsMaster) {
      const result = await this._resolveHls(hlsMaster);
      if (result) {
        this._log(`[OKRuResolver] Selected stream type: ${result.type}`);
        this._log('[OKRuResolver] Resolution successful');
        return ResolverResult.ok({
          provider: this.providerId,
          sourceUrl,
          streamUrl: result.streamUrl,
          type: result.type,
          headers: {
            'User-Agent': OKRU_USER_AGENT,
          },
          expiresAt: pickExpiresAt(hlsMaster) || result.expiresAt,
          metadata: {
            videoId,
            quality: result.quality,
            resolution: result.resolution,
          },
        });
      }
    }

    const direct = pickDirectVideo(meta);
    if (direct) {
      const streamUrl = direct.url;
      const quality = direct.name || null;
      const streamType = detectStreamType(streamUrl) === 'unknown' ? STREAM_TYPES.MP4 : detectStreamType(streamUrl);
      this._log(`[OKRuResolver] Selected stream type: ${streamType}`);
      this._log('[OKRuResolver] Resolution successful');
      return ResolverResult.ok({
        provider: this.providerId,
        sourceUrl,
        streamUrl,
        type: streamType,
        headers: {
          'User-Agent': OKRU_USER_AGENT,
        },
        metadata: {
          videoId,
          quality,
          resolution: null,
        },
      });
    }

    throw new ResolutionFailedError('OK.ru video does not expose a playable stream');
  }

  async _resolveHls(master) {
    const response = await this._http(master, {
      headers: {
        Referer: 'https://ok.ru/',
      },
      timeoutMs: OKRU_MASTER_TIMEOUT_MS,
      responseType: 'text',
    });

    if (response.status >= 400) {
      return null;
    }

    const variants = parseMasterVariants(response.body || '', master);
    const best = pickBestVariant(variants);
    if (best) {
      return {
        streamUrl: best.url,
        type: STREAM_TYPES.HLS,
        quality: best.quality,
        resolution: best.resolution,
      };
    }

    // Accept the master playlist as the stream target when it is already a
    // media playlist (no variant list on the response).
    if (String(response.body || '').includes('#EXT-X-MEDIA-SEQUENCE')) {
      return {
        streamUrl: master,
        type: STREAM_TYPES.HLS,
        quality: null,
        resolution: null,
      };
    }

    return null;
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isOkRuPlayerUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not an OK.ru player: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _parsePlayerPayload(body, pageUrl) {
    const match = body.match(DATA_OPTIONS_RE);
    if (!match) {
      throw new ResolverParseError(`OK.ru embed has no data-options payload for ${redactUrl(pageUrl)}`);
    }
    const decoded = decodeDataOptions(match[1]);
    let parsed;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new ResolverParseError(`OK.ru embed payload is not JSON for ${redactUrl(pageUrl)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ResolverParseError(`OK.ru embed payload has an unexpected shape for ${redactUrl(pageUrl)}`);
    }
    return parsed;
  }

  _classifyPageStatus(status, pageUrl) {
    const target = redactUrl(pageUrl);
    if (status === 404 || status === 410) {
      return new SourceNotFoundError(`OK.ru video returned HTTP ${status}`);
    }
    if (status === 401 || status === 403) {
      return new ResolverBlockedError(`OK.ru page returned HTTP ${status} for ${target}`);
    }
    if (status === 429) {
      return new ResolverRateLimitedError(`OK.ru rate limited for ${target}`);
    }
    if (status >= 500) {
      return new UpstreamError(`OK.ru page returned HTTP ${status} for ${target}`);
    }
    return new UpstreamError(`OK.ru page returned unexpected HTTP ${status} for ${target}`);
  }

  _log(message) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message);
    }
  }
}

module.exports = { OKRuResolver, isOkRuUrl, isOkRuPlayerUrl, extractOkRuVideoId, decodeDataOptions, findMetadata, pickHlsMaster, parseMasterVariants, pickBestVariant, pickDirectVideo, pickExpiresAt };