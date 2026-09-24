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
const { createResolverFetcher, parseUrl, redactUrl } = require('../../core/resolver.utils');
const { UQLOAD_HOSTS, UQLOAD_TIMEOUT_MS, UQLOAD_USER_AGENT, EMBED_FILE_RE, E_PATH_RE } = require('./uqload.constants');
const { parseUqloadPage } = require('./uqload.parser');

function isUqloadHost(hostname) {
  return UQLOAD_HOSTS.some((candidate) => {
    const host = (hostname || '').toLowerCase();
    return host === candidate || host.endsWith(`.${candidate}`);
  });
}

function extractUqloadId(url) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  if (EMBED_FILE_RE.test(path.split('/').pop())) {
    const id = path.split('/').pop().replace(EMBED_FILE_RE, '$1');
    return /^[a-zA-Z0-9]+$/.test(id) ? id : null;
  }
  const eMatch = path.match(E_PATH_RE);
  if (eMatch) {
    return /^[a-zA-Z0-9]+$/.test(eMatch[1]) ? eMatch[1] : null;
  }
  return null;
}

function toUqloadEmbedUrl(url, id) {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = `/embed-${id}.html`;
  return parsed.toString();
}

class UqloadResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.UQLOAD);
    this._http = options.http || createResolverFetcher({ headers: { 'User-Agent': UQLOAD_USER_AGENT } });
  }

  canResolve(url) {
    if (typeof url !== 'string') return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return isUqloadHost(parsed.hostname);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractUqloadId(sourceUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError(`Uqload URL does not contain a video identifier: ${redactUrl(sourceUrl)}`);
    }
    const embedUrl = toUqloadEmbedUrl(sourceUrl, videoId);

    let response;
    try {
      response = await this._http(embedUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          Referer: `${new URL(embedUrl).origin}/`,
        },
        timeoutMs: UQLOAD_TIMEOUT_MS,
        responseType: 'text',
      });
    } catch (error) {
      throw error;
    }

    if (response.status >= 400) {
      this._throwForStatus(response.status, `Uqload page returned HTTP ${response.status}`);
    }

    const parsed = parseUqloadPage(response.body || '', response.finalUrl || embedUrl);
    if (!parsed || !parsed.mediaUrl) {
      throw new ResolverParseError(`Could not extract Uqload media URL from ${redactUrl(embedUrl)}`);
    }

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: parsed.mediaUrl,
      type: parsed.type,
      headers: parsed.headers || {},
      metadata: parsed.metadata || {},
    });
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
    if (!isUqloadHost(parsed.hostname)) {
      throw new InvalidSourceUrlError(`URL is not a supported Uqload embed: ${redactUrl(parsed)}`);
    }
    parsed.hash = '';
    return parsed.toString();
  }
}

module.exports = { UqloadResolver, isUqloadHost, extractUqloadId, toUqloadEmbedUrl };