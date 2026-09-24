'use strict';

const { URL } = require('url');
const { EMBED_HOSTS, EMBED_PATH_RE } = require('./mp4upload.constants');

function isMp4UploadHost(hostname) {
  return EMBED_HOSTS.some((candidate) => {
    const host = (hostname || '').toLowerCase();
    return host === candidate || host.endsWith(`.${candidate}`);
  });
}

function isMp4UploadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isMp4UploadHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractMp4UploadId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const file = parts[parts.length - 1] || '';
  const id = file
    .replace(/^embed-/i, '')
    .replace(/\.html$/i, '');
  const videoId = id.split('?')[0];
  return /^[a-zA-Z0-9]+$/.test(videoId) ? videoId : null;
}

function toMp4UploadEmbedUrl(url) {
  const id = extractMp4UploadId(url);
  if (!id) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = `/embed-${id}.html`;
  return parsed.toString();
}

module.exports = { isMp4UploadHost, isMp4UploadUrl, extractMp4UploadId, toMp4UploadEmbedUrl };