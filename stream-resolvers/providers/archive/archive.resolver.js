'use strict';

const { URL } = require('url');

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { parseUrl, redactUrl, detectStreamType } = require('../../core/resolver.utils');
const { InvalidSourceUrlError } = require('../../core/resolver.errors');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const {
  ARCHIVE_HOSTNAME_RE,
  ARCHIVE_DISTRIBUTION_HOSTNAME_RE,
  ARCHIVE_DOWNLOAD_PATH_RE,
  ARCHIVE_MEDIA_EXTENSIONS,
  ARCHIVE_USER_AGENT,
} = require('./archive.constants');

function isArchiveHost(hostname) {
  if (typeof hostname !== 'string') return false;
  if (ARCHIVE_HOSTNAME_RE.test(hostname)) return true;
  return ARCHIVE_DISTRIBUTION_HOSTNAME_RE.test(hostname);
}

function isArchiveUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isArchiveHost(parsed.hostname);
}

function extractArchiveFilename(parsed) {
  const match = parsed.pathname.match(ARCHIVE_DOWNLOAD_PATH_RE);
  return match ? match[1] : null;
}

function isKnownMediaExtension(filename) {
  if (typeof filename !== 'string') return false;
  return ARCHIVE_MEDIA_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext));
}

function isArchiveDirectUrl(url) {
  if (!isArchiveUrl(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^\/download\//.test(parsed.pathname)) return false;
  const filename = extractArchiveFilename(parsed);
  if (!filename) return false;
  return isKnownMediaExtension(filename);
}

class ArchiveResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.ARCHIVE);
  }

  canResolve(url) {
    return isArchiveDirectUrl(url);
  }

  async resolve(url, options = {}) {
    const sourceUrl = this._validateInputUrl(url);
    const parsed = new URL(sourceUrl);

    this._log(`[ArchiveResolver] URL detected: ${redactUrl(sourceUrl)}`);
    this._log(`[ArchiveResolver] Host: ${parsed.hostname}`);
    this._log('[ArchiveResolver] Direct media URL detected');

    const filename = extractArchiveFilename(parsed);
    const extensionMatch = (filename || '').toLowerCase();
    const extension = ARCHIVE_MEDIA_EXTENSIONS.find((ext) => extensionMatch.endsWith(ext)) || null;
    if (extension) {
      this._log(`[ArchiveResolver] Extension: ${extension.slice(1)}`);
    }

    this._log('[ArchiveResolver] Resolution successful');

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl,
      streamUrl: sourceUrl,
      type: detectStreamType(sourceUrl),
      headers: {
        'User-Agent': ARCHIVE_USER_AGENT,
      },
      metadata: {
        filename,
      },
    });
  }

  _validateInputUrl(url) {
    if (typeof url !== 'string') {
      throw new InvalidSourceUrlError('URL must be a string');
    }
    const parsed = parseUrl(url);
    if (!isArchiveDirectUrl(parsed.toString())) {
      throw new InvalidSourceUrlError(`URL is not an Internet Archive direct file: ${redactUrl(parsed)}`);
    }
    return parsed.toString();
  }

  _log(message) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message);
    }
  }
}

module.exports = { ArchiveResolver, isArchiveHost, isArchiveUrl, isArchiveDirectUrl, extractArchiveFilename, isKnownMediaExtension };