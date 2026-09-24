'use strict';

const EMBED_HOSTS = [
  'dood.la',
  'dood.li',
  'dood.sh',
  'dood.re',
  'dood.wf',
  'dood.so',
  'dood.cx',
  'dood.yt',
  'dood.watch',
  'dood.pm',
  'dood.to',
  'dood.ws',
  'd000d.com',
  'd0000d.com',
  'dooood.com',
  'doodstream.com',
  'doods.pro',
  'dsvplay.com',
  'ds2play.com',
  'ds2video.com',
  'vide0.net',
  'myvidplay.com',
  'playmogo.com',
];

const EMBED_PATH_RE = /^\/(e|d|f|v)\/[a-zA-Z0-9]+/;

const EMBED_TIMEOUT_MS = 15000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_RESOLUTION_STEPS = 2;

module.exports = { EMBED_HOSTS, EMBED_PATH_RE, EMBED_TIMEOUT_MS, USER_AGENT, MAX_RESOLUTION_STEPS };
