'use strict';

const UQLOAD_HOSTS = [
  'uqload.is',
  'uqload.io',
  'uqload.com',
  'uqload.net',
  'uqload.org',
  'uqload.ws',
  'uqload.co',
];

const EMBED_HOSTS = UQLOAD_HOSTS;

const EMBED_PATH_RE = /^\/(?:embed-[a-zA-Z0-9]+\.html|(?!embed-)[a-zA-Z0-9]+\.html|e\/[a-zA-Z0-9]+)$/;
const EMBED_FILE_RE = /^(?:embed-)?([a-zA-Z0-9]+)\.html$/;
const E_PATH_RE = /^\/e\/([a-zA-Z0-9]+)$/;

const UQLOAD_TIMEOUT_MS = 15000;
const UQLOAD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_MEDIA_URL_LENGTH = 2048;

module.exports = {
  UQLOAD_HOSTS,
  EMBED_HOSTS,
  EMBED_PATH_RE,
  EMBED_FILE_RE,
  E_PATH_RE,
  UQLOAD_TIMEOUT_MS,
  UQLOAD_USER_AGENT,
  USER_AGENT: UQLOAD_USER_AGENT,
  MAX_MEDIA_URL_LENGTH,
};