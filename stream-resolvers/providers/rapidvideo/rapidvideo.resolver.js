'use strict';

const { URL } = require('url');
const axios = require('axios');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');
const { fetchWithBrowser } = require('../../../utils/session-provider');

const RAPIDVIDEO_HOSTS = [
  'rapidvideo.link',
  'rapidvideo.stream',
  'rapidvideo.icu',
  'rapidvideo.wtf',
  'rapidvideo.vip',
  'rvf.io',
  'rapidvideo.yt',
];

function isRapidVideoUrl(url) {
  try {
    const parsed = new URL(url);
    if (!RAPIDVIDEO_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
    return /^\/(e|v|embed|d|file|download)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

const UA = DEFAULT_OPTIONS.defaultUserAgent;

class RapidVideoResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.RAPIDVIDEO || 'rapidvideo');
    this._timeout = options.httpTimeoutMs || 45000;
  }

  canResolve(url) {
    return isRapidVideoUrl(url);
  }

  async _captureWithBrowser(url) {
    const html = await fetchWithBrowser(url);
    let foundUrl = null;

    // Parse HTML for media URLs
    const mediaPattern = /(?:src|href)=['"](?:(?:m3u8|mp4|mpd)[^'">]*|(?:m3u8|mp4|mpd)[^'">]*['"])/gi;
    const matches = html.match(mediaPattern);
    if (matches) {
      for (const match of matches) {
        const clean = match.replace(/(^['"]|['"]$)/g, '');
        if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(clean) && !/(google|analytics|yandex|cloudflare|googletagmanager)/i.test(clean)) {
          foundUrl = clean;
          break;
        }
      }
    }

    if (!foundUrl) return null;

    // Determine stream type
    const type = /\.mpd(\?|$)/i.test(foundUrl) ? STREAM_TYPES.DASH
      : /\.(mp4|webm|mkv)(\?|$)/i.test(foundUrl) ? STREAM_TYPES.MP4
      : STREAM_TYPES.HLS;

    return { foundUrl, finalReferer: url };
  }

  async resolve(url, options = {}) {
    // Preflight: si el host responde 404, no abrimos el navegador.
    try {
      const pre = await axios.get(url, { headers: { 'User-Agent': UA, Referer: 'https://pelispedia.mov/' }, timeout: 15000, maxRedirects: 5, validateStatus: () => true });
      if (pre.status === 404 || pre.status === 410) {
        const { SourceNotFoundError } = require('../../core/resolver.errors');
        throw new SourceNotFoundError(`RapidVideo returned HTTP ${pre.status} for ${url}`);
      }
    } catch (e) {
      if (e && e.name === 'SourceNotFoundError') throw e;
      // otros errores de red: seguimos intentando con el navegador
    }

    const captured = await this._captureWithBrowser(url);
    if (!captured || !captured.foundUrl) {
      const { ResolverParseError } = require('../../core/resolver.errors');
      throw new ResolverParseError(`RapidVideo: no media stream could be extracted from ${url}`);
    }

    const type = /\.mpd(\?|$)/i.test(captured.foundUrl) ? STREAM_TYPES.DASH
      : /\.(mp4|webm|mkv)(\?|$)/i.test(captured.foundUrl) ? STREAM_TYPES.MP4
      : STREAM_TYPES.HLS;

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl: url,
      streamUrl: captured.foundUrl,
      type,
      headers: {
        Referer: captured.finalReferer,
        'User-Agent': UA,
        ...(captured.cookie ? { Cookie: captured.cookie } : {}),
      },
    });
  }
}

module.exports = { RapidVideoResolver, isRapidVideoUrl };
