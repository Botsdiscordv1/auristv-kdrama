'use strict';

// Byse embeds are served from these origins. Player URLs follow:
//   https://{host}/e/{fileCode}              with optional trailing slash and query
//   https://{host}/e/{fileCode}/{suffix}     some mirrors append a suffix segment after the code
//   https://{host}/d/{fileCode}              download-style links map to the same file code
const BYSE_HOSTS = [
  'bysekoze.com',
  'bysesukior.com',
  'bysevepoin.com',
];

const BYSE_HOST_RE = /(?:^|\.)(?:bysekoze|bysesukior|bysevepoin|filemoon|luluvdo)\.[a-z]{2,}$/i;

const BYSE_EMBED_PATH_RE = /^\/(?:e|d)\/([A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_-]+)*\/?$/;

const BYSE_API_TIMEOUT_MS = 15000;

const BYSE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Playback envelope limits (mirrors the client player).
const BYSE_KEY_PART_MAX = 30; // max number of key_parts the server can emit
const BYSE_VERSION_MAX = 20; // version 1..20 maps to key parts [version, 31-version]
const BYSE_GCM_TAG_BYTES = 16;

module.exports = {
  BYSE_HOSTS,
  BYSE_HOST_RE,
  BYSE_EMBED_PATH_RE,
  BYSE_API_TIMEOUT_MS,
  BYSE_USER_AGENT,
  BYSE_KEY_PART_MAX,
  BYSE_VERSION_MAX,
  BYSE_GCM_TAG_BYTES,
};