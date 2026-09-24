'use strict';

const YOURUPLOAD_HOSTS = [
  'yourupload.com',
];

const WATCH_PATH_RE = /^\/watch\/([A-Za-z0-9]+)(?:[/?#].*)?$/;
const EMBED_PATH_RE = /^\/embed\/([A-Za-z0-9]+)(?:[/?#].*)?$/;

const DOWNLOAD_FILE_RE = /\/download\?file=(\d+)/;
const DOWNLOAD_TOKEN_RE = /token=([0-9a-f]+)/i;

const YOURUPLOAD_TIMEOUT_MS = 15000;
const YOURUPLOAD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = {
  YOURUPLOAD_HOSTS,
  WATCH_PATH_RE,
  EMBED_PATH_RE,
  DOWNLOAD_FILE_RE,
  DOWNLOAD_TOKEN_RE,
  YOURUPLOAD_TIMEOUT_MS,
  YOURUPLOAD_USER_AGENT,
  USER_AGENT: YOURUPLOAD_USER_AGENT,
};