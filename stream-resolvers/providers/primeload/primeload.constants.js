'use strict';

const PRIMELOAD_HOST_RE = /(?:^|\.)(?:primeload)\.[a-z]{2,}$/i;
const PRIMELOAD_EMBED_PATH_RE = /^\/(?:embed|player)\/([A-Za-z0-9_-]+)\/?$/;
const PRIMELOAD_CDN_HOST_RE = /(?:^|\.)primecdn\.co$/i;
const PRIMELOAD_API_TIMEOUT_MS = 15000;
const PRIMELOAD_AUTH_TIMEOUT_MS = 12000;
const PRIMELOAD_WS_TIMEOUT_MS = 10000;
const PRIMELOAD_SESSION_TTL_MS = 30 * 60 * 1000;
const PRIMELOAD_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = {
  PRIMELOAD_HOST_RE,
  PRIMELOAD_EMBED_PATH_RE,
  PRIMELOAD_CDN_HOST_RE,
  PRIMELOAD_API_TIMEOUT_MS,
  PRIMELOAD_AUTH_TIMEOUT_MS,
  PRIMELOAD_WS_TIMEOUT_MS,
  PRIMELOAD_SESSION_TTL_MS,
  PRIMELOAD_USER_AGENT,
};
