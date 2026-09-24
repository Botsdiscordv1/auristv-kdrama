'use strict';

const VOE_HOSTS = [
  'voe.sx',
  'vev.io',
  'voe.top',
  'voe.live',
  'voesx.com',
  'voe-unblock.com',
  'nicolehappyoutside.com',
];

const VOE_EMBED_PATH_RE = /^\/(e|v)\/[a-zA-Z0-9]+/;

const EMBED_HOSTS = VOE_HOSTS;
const EMBED_PATH_RE = VOE_EMBED_PATH_RE;

const VOE_TIMEOUT_MS = 15000;

const VOE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_RESOLUTION_STEPS = 2;

module.exports = {
  VOE_HOSTS,
  VOE_EMBED_PATH_RE,
  VOE_TIMEOUT_MS,
  VOE_USER_AGENT,
  MAX_RESOLUTION_STEPS,
  EMBED_HOSTS,
  EMBED_PATH_RE,
  USER_AGENT: VOE_USER_AGENT,
};
