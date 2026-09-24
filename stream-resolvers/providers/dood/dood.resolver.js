'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const {
  InvalidSourceUrlError,
  SourceNotFoundError,
  ResolverParseError,
  ResolverBlockedError,
  ResolverRateLimitedError,
  UpstreamError,
} = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { parseUrl, redactUrl } = require('../../core/resolver.utils');
const { USER_AGENT } = require('./dood.constants');
const { isDoodUrl, extractDoodId, parseDoodPage, parseDoodSource } = require('./dood.parser');
const { fetchText } = require('./dood-http-client');

const RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASS_MD5_PATH_RE = /\/pass_md5\/([a-z0-9-]+)\/([a-z0-9]+)/i;
const TOKEN_MAKEPLAY_RE = /[?&]token=([a-z0-9]+)/i;

class DoodResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.DOOD);
    this._http = options.http || null;
  }

  canResolve(url) {
    return isDoodUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const pageUrl = this._normalizeInputUrl(sourceUrl);
    const videoId = extractDoodId(pageUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError('Dood URL does not contain a video identifier');
    }

    // Document mode: loads the embed page and follows the permanent redirect to
    // the active mirror (e.g. playmogo.com). The mirror origin is then used for
    // the pass_md5 request and as Referer. Plain axios/Node TLS gets a
    // Cloudflare 403 here; the Chrome-fingerprinted client does not.
    const page = await this._fetchPage(pageUrl);
    if (page.status >= 400) {
      this._throwForStatus(page.status, `Dood page returned HTTP ${page.status}`);
    }

    const pageData = parseDoodPage(page.body, page.url);
    if (!pageData) {
      throw new ResolverParseError(`Could not parse Dood page from ${redactUrl(page.url)}`);
    }
    if (pageData.notFound) {
      throw new SourceNotFoundError('Dood page returned a not-found response');
    }
    if (pageData.blocked) {
      throw new ResolverBlockedError('Dood page returned a blocked response');
    }

    const passMd5Path = pageData.passMd5Path;
    const md5Token =
      (passMd5Path.match(PASS_MD5_PATH_RE) || [])[2]
      || (page.body.match(TOKEN_MAKEPLAY_RE) || [])[1]
      || new URL(new URL(passMd5Path, page.url).toString()).pathname.split('/').filter(Boolean).pop()
      || '';
    if (!md5Token) {
      throw new ResolverParseError(`Could not determine Dood token from ${redactUrl(passMd5Path)}`);
    }

    const origin = new URL(page.url).origin;
    const md5Url = new URL(passMd5Path, origin).toString();

    const sourceResponse = await this._fetchSource(md5Url, `${origin}/e/${videoId}`);
    if (sourceResponse.status >= 400) {
      this._throwForStatus(sourceResponse.status, `Dood source request returned HTTP ${sourceResponse.status}`);
    }

    const parsedSource = parseDoodSource(sourceResponse.body || '', md5Url);
    if (!parsedSource || !parsedSource.mediaUrl) {
      throw new ResolverParseError(`Could not extract a Dood media URL from ${redactUrl(md5Url)}`);
    }

    const finalUrl = this._composeFinalUrl(parsedSource.mediaUrl, md5Token);
    const headers = {
      Referer: `${origin}/`,
      'User-Agent': USER_AGENT,
    };

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: finalUrl,
      type: 'mp4',
      headers,
      metadata: { quality: pageData.quality || null },
    });
  }

  async _fetchPage(url) {
    if (this._http) {
      const r = await this._http(url, { headers: { Accept: 'text/html' }, responseType: 'text' });
      return { status: r.status, body: r.body || '', headers: r.headers || {}, url: r.finalUrl || r.url || url };
    }
    return fetchText(url, {}, 'document');
  }

  async _fetchSource(url, referer) {
    if (this._http) {
      const r = await this._http(url, { headers: { Referer: referer }, responseType: 'text' });
      return { status: r.status, body: r.body || '', headers: r.headers || {}, url: r.finalUrl || r.url || url };
    }
    return fetchText(url, { referer }, 'fetch');
  }

  _composeFinalUrl(baseUrl, token) {
    const [beforeQuery, query] = String(baseUrl).split('?');
    const suffix = this._createHashTable();
    const expiry = Date.now();
    if (!query) return `${beforeQuery}${suffix}?token=${token}&expiry=${expiry}`;
    return `${beforeQuery}${suffix}?${query}&token=${token}&expiry=${expiry}`;
  }

  _createHashTable() {
    let out = '';
    for (let i = 0; i < 10; i += 1) {
      out += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)];
    }
    return out;
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
    if (!isDoodUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported Dood embed: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _normalizeInputUrl(inputUrl) {
    const url = new URL(inputUrl);
    if (/^\/(d|f|v)\//i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/^\/(d|f|v)\//i, '/e/');
    }
    url.hash = '';
    return url.toString();
  }
}

module.exports = { DoodResolver };
