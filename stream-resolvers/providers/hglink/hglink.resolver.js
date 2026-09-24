'use strict';

const { URL } = require('url');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');
const { fetchWithBrowser } = require('../../../utils/session-provider');

const HGLINK_HOSTS = ['hglink.to', 'vibuxer.com', 'vibuxer.org'];

function isHglinkUrl(url) {
  try {
    const parsed = new URL(url);
    if (!HGLINK_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
    return /^\/(e|embed|f|v|d|file)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

const UA = DEFAULT_OPTIONS.defaultUserAgent;

class HglinkResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.HGLINK || 'hglink');
    this._timeout = options.httpTimeoutMs || 45000;
  }

  canResolve(url) {
    return isHglinkUrl(url);
  }

  async resolve(url, options = {}) {
    const html = await fetchWithBrowser(url);
    let foundUrl = null;

    // Parse HTML for m3u8 URLs
    const mediaPattern = /['"]([^"']+\.m3u8(?:\?[^"']*)?)['"]/gi;
    const matches = html.match(mediaPattern);
    if (matches) {
      for (const match of matches) {
        const clean = match.replace(/['"]/g, '');
        if (/^https?:\/\//i.test(clean) && /\.(m3u8)(\?|$)/i.test(clean)) {
          foundUrl = clean;
          break;
        }
      }
    }

    if (!foundUrl) {
      throw new Error('HGLINK: no m3u8 stream could be captured');
    }

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl: url,
      streamUrl: foundUrl,
      type: STREAM_TYPES.HLS,
      headers: {
        Referer: url,
        'User-Agent': UA,
      },
    });
  }
}

module.exports = { HglinkResolver, isHglinkUrl };