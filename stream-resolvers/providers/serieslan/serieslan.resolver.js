'use strict';

const axios = require('axios');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function extractStreamUrl(html) {
  // El player de serieslan apunta a stream.php?f=<base64> (el MP4 real).
  const direct = html.match(/stream\.php\?f=[A-Za-z0-9+/=]+/i);
  if (direct) return direct[0];

  const srcRe = /<(?:source|video)[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = srcRe.exec(html)) !== null) {
    const s = m[1];
    if (/\.(mp4|m3u8|webm)/i.test(s) || /stream\.php\?f=/i.test(s)) return s;
  }
  return null;
}

class SerieslanResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.SERIESLAN || 'serieslan');
    this._timeout = options.httpTimeoutMs || DEFAULT_OPTIONS.httpTimeoutMs;
  }

  canResolve(url) {
    return /serieslan\.online/i.test(url || '');
  }

  async resolve(url) {
    // Ya es el stream directo (MP4 servido por stream.php).
    if (/\/stream\.php\?f=/i.test(url)) {
      return ResolverResult.ok({
        provider: this.providerId,
        sourceUrl: url,
        streamUrl: url,
        type: STREAM_TYPES.MP4,
        headers: { Referer: 'https://serieslan.online/', 'User-Agent': UA },
      });
    }

    const resp = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://serieslan.online/',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      timeout: this._timeout,
      maxRedirects: 5,
    });
    const html = typeof resp.data === 'string'
      ? resp.data
      : (resp.data && typeof resp.data.toString === 'function' ? resp.data.toString() : '');

    const streamPath = extractStreamUrl(html);
    if (!streamPath) {
      throw new Error('Serieslan: could not extract stream URL from player page');
    }

    const streamUrl = new URL(streamPath, url).href;

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl: url,
      streamUrl,
      type: /\.m3u8/i.test(streamUrl) ? STREAM_TYPES.HLS : STREAM_TYPES.MP4,
      headers: { Referer: 'https://serieslan.online/', 'User-Agent': UA },
    });
  }
}

module.exports = { SerieslanResolver };
