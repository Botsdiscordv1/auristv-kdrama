'use strict';

const EMBED_HOSTS = [
  'vidhide.com',
  'vidhidepro.com',
  'vidhidevip.com',
  'vidhidehub.com',
  'vidhidepre.com',
  'vidhouz.com',
  'vidhamz.xyz',
  'vidhide.buzz',
  'vidhid.click',
  'vidhitz.com',
  'morencius.com',
  'filelions.live',
  'filelions.online',
  'filelions.to',
  'kinoger.be',
  'ryderjet.com',
  'smoothpre.com',
  'dhtpre.com',
  'peytonepre.com',
];

const EMBED_PATH_RE = /^\/(embed|e|d|v|f|b|download|file)\/[a-zA-Z0-9]+/;

const EMBED_TIMEOUT_MS = 15000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = { EMBED_HOSTS, EMBED_PATH_RE, EMBED_TIMEOUT_MS, USER_AGENT };
