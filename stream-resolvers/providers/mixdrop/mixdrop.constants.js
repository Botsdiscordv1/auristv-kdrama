'use strict';

const EMBED_HOSTS = [
  'mixdrop.co',
  'mixdrop.to',
  'mixdrop.ch',
  'mixdrop.gl',
  'mixdrop.sx',
  'mixdrop.ag',
  'mixdrop.hn',
  'mixdrop.ms',
  'mixdrop.bz',
  'mixdrop.cc',
  'miixdrop.net',
  'miixdrop.is',
  'miixdrop.co',
  'miixdrop.to',
  'mixdrop.top',
'mxdrop.to',
];

const EMBED_PATH_RE = /^\/(e|f)\/[A-Za-z0-9]+/;

const SITE_ORIGIN = 'https://miixdrop.net/';

const CDN_HOST_SUFFIX = '.mxcontent.net';

const EMBED_TIMEOUT_MS = 15000;

const CDN_PROBE_TIMEOUT_MS = 8000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = {
  EMBED_HOSTS,
  EMBED_PATH_RE,
  SITE_ORIGIN,
  CDN_HOST_SUFFIX,
  EMBED_TIMEOUT_MS,
  CDN_PROBE_TIMEOUT_MS,
  USER_AGENT,
};