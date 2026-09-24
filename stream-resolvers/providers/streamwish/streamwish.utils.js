'use strict';

const { URL } = require('url');
const { EMBED_HOSTS, EMBED_PATH_RE } = require('./streamwish.constants');

function isStreamWishHost(hostname) {
  return EMBED_HOSTS.includes((hostname || '').toLowerCase());
}

function isStreamWishUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isStreamWishHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractStreamWishId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1] || '';
  return /^[a-zA-Z0-9]+$/.test(id) ? id : null;
}

module.exports = { isStreamWishHost, isStreamWishUrl, extractStreamWishId };