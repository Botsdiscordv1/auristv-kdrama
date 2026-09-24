'use strict';

const { URL } = require('url');
const { VOE_HOSTS, EMBED_PATH_RE } = require('./voe.constants');

function isVoeHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return VOE_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function isVoeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isVoeHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractVoeId(url) {
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

module.exports = { isVoeHost, isVoeUrl, extractVoeId };
