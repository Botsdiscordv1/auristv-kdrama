'use strict';

const { URL } = require('url');
const { EMBED_HOSTS, EMBED_PATH_RE } = require('./vidhide.constants');

function isVidHideHost(hostname) {
  return EMBED_HOSTS.includes((hostname || '').toLowerCase());
}

function isVidHideUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isVidHideHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractVidHideId(url) {
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

module.exports = { isVidHideHost, isVidHideUrl, extractVidHideId };
