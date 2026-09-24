'use strict';

const VIDARA_HOST_RE = /(?:^|\.)(?:vidaraa?)\.(?:to|cc)$/i;
const VIDARA_EMBED_PATH_RE = /^\/e\/([A-Za-z0-9_-]+)\/?$/;
const VIDARA_API_TIMEOUT_MS = 15000;
const VIDARA_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = {
  VIDARA_HOST_RE,
  VIDARA_EMBED_PATH_RE,
  VIDARA_API_TIMEOUT_MS,
  VIDARA_USER_AGENT,
};
