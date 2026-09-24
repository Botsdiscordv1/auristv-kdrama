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
} = require('../../core/resolver.utils');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');
const {
  EMBED_HOSTS,
  EMBED_TIMEOUT_MS,
  STREAM_TIMEOUT_MS,
  USER_AGENT,
  HLS_CONTENT_TYPES,
  SAVEFILES_ERROR_CODES,
} = require('./savefiles.constants');
const {
  isSavefilesHost,
  isSavefilesUrl,
  extractSavefilesFileId,
  parsePlayerConfiguration,
  findVideoSource,
} = require('./savefiles.parser');

class SaveFilesResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.SAVEFILES);
    this._http = options.http || createResolverFetcher({
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  canResolve(url) {
    return this.canHandle(url);
  }

  canHandle(url) {
    return isSavefilesUrl(url);
  }

  extractFileId(url) {
    return extractSavefilesFileId(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const fileId = extractSavefilesFileId(sourceUrl);
    if (!fileId) {
      throw new ResolverError(
        SAVEFILES_ERROR_CODES.INVALID_FILE_ID,
        'SaveFiles URL does not contain a valid file identifier',
        { retryable: false },
      );
    }

    this._log(`[SaveFilesResolver] Resolving fileId=${fileId}`);
    const embedUrl = this._buildEmbedUrl(sourceUrl, fileId);

    const page = await this._http(embedUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', Referer: embedUrl },
      timeoutMs: EMBED_TIMEOUT_MS,
      responseType: 'text',
    });

    if (page.status >= 400) {
      if (page.status === 404 || page.status === 410) {
        throw new ResolverError(
          SAVEFILES_ERROR_CODES.PAGE_FETCH_FAILED,
          `SaveFiles embed page returned HTTP ${page.status}`,
          { retryable: false },
        );
      }
      if (page.status === 401 || page.status === 403) {
        throw new ResolverError(
          SAVEFILES_ERROR_CODES.PAGE_FETCH_FAILED,
          `SaveFiles embed page returned HTTP ${page.status} (possibly protected)`,
          { retryable: false },
        );
      }
      throw new ResolverError(
        SAVEFILES_ERROR_CODES.PAGE_FETCH_FAILED,
        `SaveFiles embed page returned HTTP ${page.status}`,
        { retryable: page.status === 429 || page.status >= 500 },
      );
    }

    this._log('[SaveFilesResolver] Embed fetched');

    const config = parsePlayerConfiguration(page.body || '', page.finalUrl || embedUrl);
    if (!config) {
      throw new ResolverError(
        SAVEFILES_ERROR_CODES.PLAYER_PARSE_FAILED,
        'SaveFiles embed page could not be parsed',
        { retryable: false },
      );
    }
    this._log('[SaveFilesResolver] Player configuration detected');

    const stream = findVideoSource(page.body || '', page.finalUrl || embedUrl);
    if (!stream) {
      throw new ResolverError(
        SAVEFILES_ERROR_CODES.SOURCE_NOT_FOUND,
        'No supported playback source found in SaveFiles embed',
        { retryable: false },
      );
    }

    const type = stream.type === 'hls' ? STREAM_TYPES.HLS : STREAM_TYPES.MP4;
    const validation = this.validateStream(stream.url, type);
    if (!validation.ok) {
      throw new ResolverError(
        SAVEFILES_ERROR_CODES.STREAM_INVALID,
        `SaveFiles stream is invalid: ${validation.reason}`,
        { retryable: false },
      );
    }

    this._log(`[SaveFilesResolver] Source detected type=${stream.type}`);
    this._log('[SaveFilesResolver] Resolution successful');

    const origin = new URL(sourceUrl).origin;
    const headers = {};
    headers.Referer = `${origin}/`;
    headers['User-Agent'] = USER_AGENT;

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: stream.url,
      type,
      headers,
      metadata: {
        fileId,
        playerType: config.playerType || null,
        contentType: type === STREAM_TYPES.HLS ? 'application/vnd.apple.mpegurl' : null,
      },
    });
  }

  validateStream(url, type) {
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
    if (type === STREAM_TYPES.HLS && !/\.m3u8($|[?#])/i.test(url.split('?')[0])) {
      return { ok: false, reason: 'hls source does not point to an m3u8 playlist' };
    }
    if (type === STREAM_TYPES.MP4 && !/\.(mp4|m4v|mov|webm|mkv)($|[?#])/i.test(url.split('?')[0])) {
      return { ok: false, reason: 'mp4 source does not point to a media file' };
    }
    return { ok: true, type };
  }

  _buildEmbedUrl(sourceUrl, fileId) {
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      return `https://${EMBED_HOSTS[0]}/e/${fileId}`;
    }
    const origin = parsed.origin || `https://${EMBED_HOSTS[0]}`;
    return `${origin}/e/${fileId}`;
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new ResolverError(SAVEFILES_ERROR_CODES.INVALID_URL, 'URL must be a string', { retryable: false });
    }
    const parsed = parseUrl(url);
    if (!isSavefilesHost(parsed.hostname) || !/^\/e\//.test(parsed.pathname)) {
      throw new ResolverError(
        SAVEFILES_ERROR_CODES.INVALID_URL,
        `URL is not a supported SaveFiles embed: ${redactUrl(parsed)}`,
        { retryable: false },
      );
    }
    return parsed.toString();
  }

  _log(message) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message);
    }
  }
}

module.exports = {
  SaveFilesResolver,
  isSavefilesUrl,
  extractSavefilesFileId,
  parsePlayerConfiguration,
  findVideoSource,
};
