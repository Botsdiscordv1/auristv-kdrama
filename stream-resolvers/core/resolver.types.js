'use strict';

const STREAM_TYPES = Object.freeze({
  MP4: 'mp4',
  HLS: 'hls',
  DASH: 'dash',
  UNKNOWN: 'unknown',
});

const PROVIDER_IDS = Object.freeze({
  MIXDROP: 'mixdrop',
  STREAMTAPE: 'streamtape',
  FILEMOON: 'filemoon',
  VIDHIDE: 'vidhide',
  STREAMWISH: 'streamwish',
  DOOD: 'dood',
  VOE: 'voe',
  MP4UPLOAD: 'mp4upload',
  MEGA: 'mega',
  UQLOAD: 'uqload',
  YOURUPLOAD: 'yourupload',
  ZILLA_URL: 'zilla',
  NIKA_HLS: 'nika',
  UPNSHARE: 'upnshare',
  BYSE: 'byse',
  OKRU: 'okru',
  ARCHIVE: 'archive',
  HEXLOAD: 'hexload',
  SAVEFILES: 'savefiles',
  YTPLAY: 'ytplay',
  D23: 'd23',
  BARMOREY: 'barmonrey',
  STREAMHJ: 'streamhj',
  VIDARA: 'vidara',
  SERIESLAN: 'serieslan',
  PLAYMOGO: 'playmogo',
  EMBED69: 'embed69',
  HGLINK: 'hglink',
  RAPIDVIDEO: 'rapidvideo',
  GNULAPLAYER: 'gnulaplayer',
});

const ERROR_CODES = Object.freeze({
  INVALID_URL: 'INVALID_URL',
  UNSUPPORTED_URL: 'UNSUPPORTED_URL',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  PARSER_ERROR: 'PARSER_ERROR',
  TOKEN_ERROR: 'TOKEN_ERROR',
  SIGNATURE_ERROR: 'SIGNATURE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  FORBIDDEN: 'FORBIDDEN',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  STREAM_INVALID: 'STREAM_INVALID',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SSRF_DETECTED: 'SSRF_DETECTED',
  RESOLUTION_FAILED: 'RESOLUTION_FAILED',
  UNSUPPORTED_MEDIA: 'UNSUPPORTED_MEDIA',
});

const RETRYABLE_STATUS_CODES = Object.freeze([408, 425, 429, 500, 502, 503, 504]);

const CONTENT_TYPE_HINTS = Object.freeze([
  { type: 'hls', re: /application\/vnd\.apple\.mpegurl|application\/x-mpegurl/i },
  { type: 'hls', re: /audio\/m2ts|audio\/mp2t|audio\/mpegurl/i },
  { type: 'dash', re: /application\/dash\+xml|application\/mpegdash/i },
  { type: 'mp4', re: /video\/mp4|video\/quicktime|video\/x-m4v/i },
]);

const DEFAULT_OPTIONS = Object.freeze({
  httpTimeoutMs: 15000,
  connectTimeoutMs: 5000,
  maxRedirects: 5,
  maxAttempts: 2,
  backoffBaseMs: 300,
  defaultUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
});

module.exports = {
  STREAM_TYPES,
  PROVIDER_IDS,
  ERROR_CODES,
  RETRYABLE_STATUS_CODES,
  CONTENT_TYPE_HINTS,
  DEFAULT_OPTIONS,
};