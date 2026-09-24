'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { ResolverError } = require('../../core/resolver.errors');
const {
  createResolverFetcher,
  parseUrl,
  redactUrl,
  detectStreamType,
  toResolverError,
} = require('../../core/resolver.utils');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');
const {
  EMBED_HOSTS,
  EMBED_PATH_RE,
  DOWNLOAD_ENDPOINT,
  DOWNLOAD_OP,
  DOWNLOAD_OPTS,
  EMBED_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  USER_AGENT,
  HEXLOAD_ERROR_CODES,
} = require('./hexload.constants');
const {
  parsePlayerConfig,
  findVideoSource,
  findHlsSource,
  findMp4Source,
  isHexloadUrl,
  extractHexloadFileId,
} = require('./hexload.parser');

class HexloadResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.HEXLOAD);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  canResolve(url) {
    return this.canHandle(url);
  }

  canHandle(url) {
    return isHexloadUrl(url);
  }

  extractFileId(url) {
    return extractHexloadFileId(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const fileId = extractHexloadFileId(sourceUrl);
    if (!fileId) {
      throw new ResolverError(
        HEXLOAD_ERROR_CODES.INVALID_FILE_ID,
        'Hexload URL does not contain a valid file identifier',
        { retryable: false },
      );
    }

    const pageUrl = sourceUrl;
    const page = await this._http(pageUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', Referer: `${new URL(sourceUrl).origin}/` },
      timeoutMs: EMBED_TIMEOUT_MS,
      responseType: 'text',
    });

    if (page.status >= 400) {
      throw new ResolverError(
        HEXLOAD_ERROR_CODES.PAGE_FETCH_FAILED,
        `Hexload embed page returned HTTP ${page.status}`,
        { retryable: page.status === 429 || page.status >= 500 },
      );
    }

    const playerConfig = parsePlayerConfig(page.body || '', pageUrl);
    if (!playerConfig) {
      throw new ResolverError(
        HEXLOAD_ERROR_CODES.SOURCE_NOT_FOUND,
        'Hexload player configuration was not found in the embed page',
        { retryable: false },
      );
    }

    const downloadUrl = this._buildDownloadUrl(playerConfig.endpoint, fileId);
    const response = await this._http(downloadUrl, {
      method: 'POST',
      headers: {
        Referer: pageUrl,
        Origin: new URL(pageUrl).origin,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      data: this._buildDownloadBody(fileId),
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      responseType: 'text',
    });

    if (response.status >= 400) {
      throw new ResolverError(
        HEXLOAD_ERROR_CODES.SOURCE_NOT_FOUND,
        `Hexload download endpoint returned HTTP ${response.status}`,
        { retryable: response.status === 429 || response.status >= 500 },
      );
    }

    const stream = findVideoSource(response.body || '');
    if (!stream) {
      throw new ResolverError(
        HEXLOAD_ERROR_CODES.SOURCE_NOT_FOUND,
        'No supported playback source found in Hexload response',
        { retryable: false },
      );
    }

    const validation = this.validateStream(stream.url);
    if (!validation.ok) {
      throw new ResolverError(
        HEXLOAD_ERROR_CODES.STREAM_INVALID,
        `Hexload stream is invalid: ${validation.reason}`,
        { retryable: false },
      );
    }

    const origin = new URL(sourceUrl).origin;
    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: stream.url,
      type: stream.type,
      headers: {
        Referer: `${origin}/`,
        'User-Agent': USER_AGENT,
      },
      metadata: {
        fileId,
        fileName: stream.fileName || null,
        size: stream.size || null,
        contentType: stream.contentType || null,
      },
    });
  }

  validateStream(url) {
    if (typeof url !== 'string' || !url) {
      return { ok: false, reason: 'missing url' };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: 'malformed url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: `unsupported protocol "${parsed.protocol}"` };
    }
    if (parsed.hostname.length === 0) {
      return { ok: false, reason: 'missing host' };
    }
    const type = detectStreamType(url);
    if (type !== STREAM_TYPES.HLS && type !== STREAM_TYPES.MP4 && type !== STREAM_TYPES.DASH) {
      return { ok: false, reason: `unsupported media type "${type}"` };
    }
    return { ok: true, type };
  }

  _buildDownloadUrl(endpoint, fileId) {
    const parsed = new URL(endpoint);
    return parsed.toString();
  }

  _buildDownloadBody(fileId) {
    const params = new URLSearchParams();
    params.set('op', DOWNLOAD_OP);
    params.set('id', fileId);
    for (const [key, value] of Object.entries(DOWNLOAD_OPTS)) {
      params.set(key, value);
    }
    return params.toString();
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new ResolverError(HEXLOAD_ERROR_CODES.INVALID_URL, 'URL must be a string', { retryable: false });
    }
    const parsed = parseUrl(url);
    if (!isHexloadUrl(parsed.toString())) {
      throw new ResolverError(
        HEXLOAD_ERROR_CODES.INVALID_URL,
        `URL is not a supported Hexload embed: ${redactUrl(parsed)}`,
        { retryable: false },
      );
    }
    return parsed.toString();
  }
}

module.exports = {
  HexloadResolver,
  isHexloadUrl,
  extractHexloadFileId,
  parsePlayerConfig,
  findVideoSource,
  findHlsSource,
  findMp4Source,
};
