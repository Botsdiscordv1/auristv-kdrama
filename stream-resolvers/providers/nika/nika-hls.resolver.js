'use strict';

const { StreamResolver } = require('../../core/resolver.interface');
const { InvalidSourceUrlError } = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { parseUrl, redactUrl } = require('../../core/resolver.utils');
const { NIKA_HOST, NIKA_M3U8_PATH_RE, NIKA_REFERER, NIKA_USER_AGENT } = require('./nika.constants');

class NikaHlsResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.NIKA_HLS);
  }

  canResolve(url) {
    return isNikaHlsUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: sourceUrl,
      type: 'hls',
      headers: {
        Referer: NIKA_REFERER,
        'User-Agent': NIKA_USER_AGENT,
      },
      title: null,
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isNikaHlsUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a Nika HLS stream: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }
}

function isNikaHlsUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.hostname.toLowerCase() !== NIKA_HOST) return false;
  return NIKA_M3U8_PATH_RE.test(parsed.pathname || '');
}

module.exports = { NikaHlsResolver, isNikaHlsUrl };
