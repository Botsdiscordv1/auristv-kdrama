'use strict';

const { StreamResolver } = require('../../core/resolver.interface');
const { InvalidSourceUrlError } = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { parseUrl, redactUrl } = require('../../core/resolver.utils');
const { ZILLA_HOST, ZILLA_M3U8_PATH_RE } = require('./zilla.constants');

class ZillaHlsResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.ZILLA_URL);
  }

  canResolve(url) {
    return isZillaHlsUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: sourceUrl,
      type: 'hls',
      headers: {},
      title: null,
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isZillaHlsUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a Zilla HLS stream: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }
}

function isZillaHlsUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.hostname.toLowerCase() !== ZILLA_HOST) return false;
  return ZILLA_M3U8_PATH_RE.test(parsed.pathname || '');
}

module.exports = { ZillaHlsResolver, isZillaHlsUrl };