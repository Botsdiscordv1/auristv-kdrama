'use strict';

const { URL } = require('url');
const { EMBED_HOSTS, EMBED_PATH_RE } = require('./filemoon.constants');

function isFileMoonHost(hostname) {
  return EMBED_HOSTS.includes((hostname || '').toLowerCase());
}

function isFileMoonUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isFileMoonHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractFileMoonId(url) {
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

module.exports = { isFileMoonHost, isFileMoonUrl, extractFileMoonId };