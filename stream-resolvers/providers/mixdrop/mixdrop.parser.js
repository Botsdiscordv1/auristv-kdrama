'use strict';

const { URL } = require('url');

const { EMBED_HOSTS, EMBED_PATH_RE, CDN_HOST_SUFFIX } = require('./mixdrop.constants');

const PACKED_RE = /return p\}\('([^']+)',(\d+),(\d+),'([^']+)'\.split\('\|'\),0,\{\}\)/;
const WURL_RE = /MDCore\.wurl="([^"]+)"/;
const TITLE_RE = /<div class="title"><a[^>]*>([^<]+)<\/a><\/div>/i;

function unpackPacked(body, count, dict) {
  const keys = dict.split('|');
  let out = body;
  while (count--) {
    if (keys[count]) {
      out = out.replace(new RegExp(`\\b${count}\\b`, 'g'), keys[count]);
    }
  }
  return out;
}

function extractStreamUrl(html) {
  const match = html.match(PACKED_RE);
  if (!match) return null;
  const decoded = unpackPacked(match[1], Number(match[3]), match[4]);
  const wurl = decoded.match(WURL_RE);
  if (!wurl || !wurl[1]) return null;
  const streamPath = wurl[1];
  if (!streamPath.startsWith('//')) return null;
  return `https:${streamPath}`;
}

function extractPageTitle(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(TITLE_RE);
  return match ? match[1].trim() : null;
}

function resolveCandidate(candidate, pageUrl) {
  let resolved;
  try {
    if (candidate.startsWith('//')) {
      return `https:${candidate}`;
    }
    resolved = new URL(candidate, pageUrl).toString();
  } catch {
    return null;
  }
  if (resolved.startsWith('https:')) return resolved;
  if (resolved.startsWith('http:')) return `https:${resolved.slice(5)}`;
  return null;
}

function isMediaCandidate(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const resolved = resolveCandidate(candidate);
  if (!resolved) return false;
  let parsed;
  try {
    parsed = new URL(resolved);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

function parseMixDrop(html, pageUrl = '') {
  if (typeof html !== 'string' || !html) return null;
  const streamUrl = extractStreamUrl(html);
  if (!streamUrl || !isMediaCandidate(streamUrl)) return null;

  let mediaUrl;
  try {
    mediaUrl = resolveCandidate(streamUrl, pageUrl);
  } catch {
    return null;
  }
  if (!mediaUrl) return null;

  return {
    mediaUrl,
    type: 'mp4',
    headers: {},
    title: extractPageTitle(html),
  };
}

function isMixDropHost(hostname) {
  return EMBED_HOSTS.includes((hostname || '').toLowerCase());
}

function matchesHostOrSubdomain(hostname, host) {
  return hostname === host || hostname.endsWith(`.${host}`);
}

function isMixDropUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isMixDropHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractVideoId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1] || '';
  return /^[A-Za-z0-9]+$/.test(id) ? id : null;
}

function isMixDropCdnHost(hostname) {
  return (hostname || '').toLowerCase().endsWith(CDN_HOST_SUFFIX);
}

module.exports = {
  parseMixDrop,
  unpackPacked,
  extractStreamUrl,
  extractPageTitle,
  resolveCandidate,
  isMediaCandidate,
  isMixDropHost,
  matchesHostOrSubdomain,
  isMixDropUrl,
  extractVideoId,
  isMixDropCdnHost,
};