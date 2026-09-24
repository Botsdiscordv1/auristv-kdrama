'use strict';

const { StreamResolver } = require('../../core/resolver.interface');
const {
  InvalidSourceUrlError,
  ResolverParseError,
  ResolverBlockedError,
  ResolverRateLimitedError,
  SourceNotFoundError,
  UpstreamError,
} = require('../../core/resolver.errors');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { createResolverFetcher, parseUrl, redactUrl } = require('../../core/resolver.utils');
const { YOURUPLOAD_TIMEOUT_MS, YOURUPLOAD_USER_AGENT } = require('./yourupload.constants');
const {
  isYourUploadUrl,
  extractYourUploadId,
  toYourUploadWatchUrl,
  toYourUploadDownloadUrl,
  parseYourUploadWatchPage,
  parseYourUploadDownloadPage,
  extractConnectSidCookie,
} = require('./yourupload.parser');

const VIDCACHE_HOST = 'vidcache.net';

class YourUploadResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.YOURUPLOAD);
    this._http = options.http || createResolverFetcher({ headers: { 'User-Agent': YOURUPLOAD_USER_AGENT } });
  }

  canResolve(url) {
    return isYourUploadUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const videoId = extractYourUploadId(sourceUrl);
    if (!videoId) {
      throw new InvalidSourceUrlError(`YourUpload URL does not contain a video identifier: ${redactUrl(sourceUrl)}`);
    }

    const watchUrl = toYourUploadWatchUrl(sourceUrl, videoId);
    const watchPage = await this._fetch(watchUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', Referer: watchUrl },
    });
    const watch = parseYourUploadWatchPage(watchPage.body || '');
    if (!watch || !watch.fileId) {
      throw new ResolverParseError(`Could not extract YourUpload file id from ${redactUrl(watchUrl)}`);
    }

    const downloadUrl = toYourUploadDownloadUrl(watchUrl, watch.fileId);
    const downloadPage = await this._fetch(downloadUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', Referer: watchUrl },
    });
    const download = parseYourUploadDownloadPage(downloadPage.body || '');
    if (!download || !download.token) {
      throw new ResolverParseError(`Could not extract YourUpload download token from ${redactUrl(downloadUrl)}`);
    }

    const cookie = extractConnectSidCookie(downloadPage.headers && downloadPage.headers['set-cookie']);
    const sendFileUrl = `${downloadUrl}&sendFile=true&token=${encodeURIComponent(download.token)}`;
    const requestHeaders = { Referer: downloadUrl };
    if (cookie) requestHeaders.Cookie = cookie;

    let media;
    try {
      media = await this._http(sendFileUrl, {
        method: 'HEAD',
        headers: requestHeaders,
        timeoutMs: YOURUPLOAD_TIMEOUT_MS,
        responseType: 'text',
      });
    } catch (error) {
      throw error;
    }

    if (!media.finalUrl || !this._isVidCacheHost(media.finalUrl)) {
      this._throwForFailedHandOff(media, sendFileUrl);
    }

    const contentType = media.headers && media.headers['content-type'];
    const type = this._detectType(media.finalUrl, contentType);

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: media.finalUrl,
      type,
      headers: { Referer: downloadUrl, 'User-Agent': YOURUPLOAD_USER_AGENT },
      title: watch.title || null,
    });
  }

  async _fetch(url, config) {
    let response;
    try {
      response = await this._http(url, {
        headers: config.headers || {},
        timeoutMs: config.timeoutMs || YOURUPLOAD_TIMEOUT_MS,
        responseType: 'text',
        method: config.method || 'GET',
      });
    } catch (error) {
      throw error;
    }
    if (response.status >= 400) {
      this._throwForStatus(response.status, `YourUpload page returned HTTP ${response.status} for ${redactUrl(url)}`);
    }
    return response;
  }

  _isVidCacheHost(url) {
    if (typeof url !== 'string') return false;
    try {
      return new URL(url).hostname.endsWith(VIDCACHE_HOST);
    } catch {
      return false;
    }
  }

  _throwForFailedHandOff(response, sendFileUrl) {
    const body = (response && response.body) || '';
    if (typeof body === 'string' && /File not found/i.test(body)) {
      throw new SourceNotFoundError(`YourUpload file not found for ${redactUrl(sendFileUrl)}`);
    }
    if (response && response.status >= 400) {
      this._throwForStatus(response.status, `YourUpload download returned HTTP ${response.status} for ${redactUrl(sendFileUrl)}`);
    }
    throw new ResolverParseError(`YourUpload did not return a vidcache media URL for ${redactUrl(sendFileUrl)}`);
  }

  _detectType(url, contentType) {
    const ct = (contentType || '').toLowerCase();
    if (/application\/(vnd\.apple\.)?mpegurl|audio\/mp2t/i.test(ct)) return 'hls';
    if (/application\/dash\+xml/i.test(ct)) return 'dash';
    if (ct && /^video\//.test(ct)) return 'mp4';
    const path = (url || '').split('?')[0];
    if (/\.m3u8($|[?#])/i.test(path)) return 'hls';
    if (/\.mpd($|[?#])/i.test(path)) return 'dash';
    if (/\.(mp4|m4v|mov|webm|mkv)($|[?#])/i.test(path)) return 'mp4';
    return 'unknown';
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
    if (!isYourUploadUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not a supported YourUpload page: ${redactUrl(parsed)}`);
    }
    const normalized = new URL(parsed.toString());
    normalized.hash = '';
    return normalized.toString();
  }
}

module.exports = { YourUploadResolver };