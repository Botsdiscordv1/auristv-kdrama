'use strict';

const EMBED_HOSTS = [
  'streamtape.com',
  'stape.fun',
  'scloud.online',
];

const EMBED_PATH_RE = /^\/(e|v)\/[^/]/;

const EMBED_TIMEOUT_MS = 15000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = {
  EMBED_HOSTS,
  EMBED_PATH_RE,
  EMBED_TIMEOUT_MS,
  USER_AGENT,
};