'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const {
  InvalidSourceUrlError,
  ResolverBlockedError,
  ResolverParseError,
  ResolverRateLimitedError,
  SourceNotFoundError,
  UpstreamError,
} = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { createResolverFetcher, parseUrl, redactUrl, detectStreamType } = require('../../core/resolver.utils');
const { MAX_RESOLUTION_STEPS, VOE_TIMEOUT_MS, VOE_USER_AGENT } = require('./voe.constants');
const { isVoeUrl, extractVoeId } = require('./voe.utils');
const { parseVoePage, parseVoeSource } = require('./voe.parser');

// VOE mirrors (e.g. nicolehappyoutside.com) now serve an ALTCHA anti-bot gate
// with PBKDF2/SHA-256 + DuckDuckGo bot protection. Cannot be solved without a
// full browser. Detect it and fail cleanly.
function isAltchaGate(html) {
  if (typeof html !== 'string') return false;
  return /altcha-widget/i.test(html) || /altcha\.min\.js/i.test(html);
}

class VoeResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.VOE);
    this._http = options.http || createResolverFetcher({ headers: { 'User-Agent': VOE_USER_AGENT } });
  }

  canResolve(url) {
    return isVoeUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const initialUrl = this._normalizeInputUrl(sourceUrl);
    const videoId = extractVoeId(initialUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('VOE URL does not contain a video identifier');
    }

    let currentUrl = initialUrl;
    for (let step = 1; step <= MAX_RESOLUTION_STEPS; step += 1) {
      const response = await this._request(currentUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          ...(step > 1 ? { Referer: initialUrl } : {}),
        },
        timeoutMs: VOE_TIMEOUT_MS,
        responseType: 'text',
      }, step);

      if (response.status >= 400) {
        this._throwForStatus(response.status, `VOE page returned HTTP ${response.status}`);
      }

      if (isAltchaGate(response.body || '')) {
        throw new ResolverBlockedError(
          `VOE embed is protected by ALTCHA anti-bot + DuckDuckGo bot protection (${redactUrl(currentUrl)})`,
        );
      }

      const pageData = step === 1
        ? parseVoePage(response.body || '', response.finalUrl || currentUrl)
        : parseVoeSource(response.body || '', response.finalUrl || currentUrl);

      if (!pageData) {
        throw new ResolverParseError(`Could not parse VOE page from ${redactUrl(currentUrl)}`);
      }

      if (pageData.mediaUrl) {
        return ResolverResult.ok({
          provider: this.providerId,
          sourceUrl,
          streamUrl: pageData.mediaUrl,
          type: pageData.type || detectStreamType(pageData.mediaUrl),
          headers: pageData.headers || {},
        });
      }

      if (!pageData.redirectUrl) {
        throw new ResolverParseError(`Could not extract a VOE media URL from ${redactUrl(currentUrl)}`);
      }

      currentUrl = new URL(pageData.redirectUrl, response.finalUrl || currentUrl).toString();
    }

    throw new ResolverParseError('VOE resolution exceeded the maximum number of steps');
  }

  async _request(url, config, step) {
    if (step > MAX_RESOLUTION_STEPS) {
      throw new ResolverParseError('VOE resolution exceeded the maximum number of steps');
    }
    try {
      return await this._http(url, config);
    } catch (error) {
      throw error;
    }
  }

  _throwForStatus(status, message) {
    if (status === 404 || status === 410) throw new SourceNotFoundError(message);
    if (status === 401 || status === 403) throw new ResolverBlockedError(message);
    if (status === 429) throw new ResolverRateLimitedError(message);
    if (status >= 500) throw new UpstreamError(message);
    throw new ResolverParseError(message);
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isVoeUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported VOE embed: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _normalizeInputUrl(inputUrl) {
    const url = new URL(inputUrl);
    url.hash = '';
    return url.toString();
  }
}

module.exports = { VoeResolver };
