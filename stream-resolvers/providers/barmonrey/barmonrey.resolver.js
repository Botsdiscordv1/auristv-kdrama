'use strict';

const axios = require('axios');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function extractStreamUrl(html) {
  // JWPlayer config: sources: [{ file: "https://...m3u8", ... }, ...]
  const srcBlock = html.match(/sources:\s*\[([\s\S]*?)\]/i);
  const pool = srcBlock ? srcBlock[1] : html;
  const files = [];
  const re = /"file"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(pool)) !== null) files.push(m[1]);
  if (!files.length) return null;
  return files.find((f) => /\.m3u8/i.test(f)) || files[0];
}

class BarmonreyResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.BARMOREY || 'barmonrey');
    this._timeout = options.httpTimeoutMs || DEFAULT_OPTIONS.httpTimeoutMs;
  }

  canResolve(url) {
    return /barmonrey\.com\/player\//i.test(url || '');
  }

  async resolve(url) {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://barmonrey.com/',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      timeout: this._timeout,
      maxRedirects: 5,
    });
    const html = typeof resp.data === 'string'
      ? resp.data
      : (resp.data && typeof resp.data.toString === 'function' ? resp.data.toString() : '');

    const streamUrl = extractStreamUrl(html);
    if (!streamUrl) {
      throw new Error('Barmonrey: could not extract stream URL from player page');
    }

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl: url,
      streamUrl,
      type: /\.m3u8/i.test(streamUrl) ? STREAM_TYPES.HLS : STREAM_TYPES.MP4,
      headers: { Referer: 'https://barmonrey.com/', 'User-Agent': UA },
    });
  }
}

module.exports = { BarmonreyResolver };
