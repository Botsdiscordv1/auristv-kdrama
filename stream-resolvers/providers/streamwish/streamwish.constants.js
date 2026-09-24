'use strict';

const EMBED_HOSTS = [
  'streamwish.com',
  'streamwish.ai',
  'streamwish.io',
  'streamwish.to',
  'streamwish.site',
  'mwish.pro',
  'dwish.pro',
  'embedwish.com',
  'wishfast.top',
  'hdvb.pro',
  'sfastwish.com',
  'strwish.xyz',
  'strwish.com',
  'flaswish.com',
  'awish.pro',
  'obeywish.com',
  'jodwish.com',
  'swhoi.com',
  'sdzjc.me',
  'faspe.online',
  'multimovies.cloud',
  'uqloads.xyz',
  'doodporn.xyz',
  'cdnwish.com',
  'asnwish.com',
  'nekowish.my.id',
  'neko-stream.click',
  'swdyu.com',
  'wishonly.site',
  'playerwish.com',
  'streamhls.to',
  'hlswish.com',
  'filelions.top',
  'filelions.com',
  'filelions.to',
];

const EMBED_PATH_RE = /^\/(embed|e|d|v|f|download|file)\/[a-zA-Z0-9]+/;

const STREAMWISH_HOSTS = EMBED_HOSTS;

const EMBED_TIMEOUT_MS = 15000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = { EMBED_HOSTS, STREAMWISH_HOSTS, EMBED_PATH_RE, EMBED_TIMEOUT_MS, USER_AGENT };
