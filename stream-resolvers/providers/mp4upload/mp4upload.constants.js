'use strict';

const MP4UPLOAD_HOSTS = [
  'mp4upload.com',
  'mp4load.com',
];

const EMBED_HOSTS = MP4UPLOAD_HOSTS;
const EMBED_PATH_RE = /^\/(?:embed-)?[a-zA-Z0-9]+(?:\.html)?\/?$/;
const MP4UPLOAD_TIMEOUT_MS = 15000;
const MP4UPLOAD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = {
  MP4UPLOAD_HOSTS,
  EMBED_HOSTS,
  EMBED_PATH_RE,
  MP4UPLOAD_TIMEOUT_MS,
  MP4UPLOAD_USER_AGENT,
  USER_AGENT: MP4UPLOAD_USER_AGENT,
};