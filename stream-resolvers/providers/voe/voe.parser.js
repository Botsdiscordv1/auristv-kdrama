'use strict';

const { URL } = require('url');

const { detectStreamType } = require('../../core/resolver.utils');

const SOURCE_RE = /(?:^|[^\w$])(?:var|let|const)?\s*source\s*[:=]\s*['"]([^'"]+)['"]/i;
const FILE_RE = /(?:^|[^\w$])file\s*[:=]\s*['"]([^'"]+)['"]/i;
const SRC_RE = /(?:^|[^\w$])src\s*[:=]\s*['"]([^'"]+)['"]/i;
const REDIRECT_RE = /(?:window|document)?\.?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i;
const REPLACE_RE = /location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i;
const URL_RE = /https?:\/\/[^\s"'<>`]+/i;
const BLOCKED_MEDIA_RE = /^(blob:|javascript:|data:|file:)/i;
const ENCODED_CONFIG_RE = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;
const SEPARATOR_RE = /@\$|\^\^|~@|%\?|\*~|!!|#&/g;

function normalizeJsEscapes(value) {
  return String(value || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .trim();
}

function rot13(value) {
  return String(value || '').replace(/[a-zA-Z]/g, (c) => {
    const code = c.charCodeAt(0);
    const base = code >= 97 ? 97 : 65;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function decodeVoeConfig(encoded) {
  if (typeof encoded !== 'string' || !encoded) return null;
  try {
    const shiftedText = rot13(encoded).replace(SEPARATOR_RE, '');
    const first = Buffer.from(shiftedText, 'base64');
    const minused = Buffer.from(first.map((byte) => byte - 3));
    const reversed = Buffer.from(minused).reverse();
    const json = Buffer.from(reversed.toString('latin1'), 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractEncodedConfig(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(ENCODED_CONFIG_RE);
  if (!match) return null;
  try {
    const array = JSON.parse(match[1]);
    if (!Array.isArray(array) || typeof array[0] !== 'string') return null;
    return decodeVoeConfig(array[0]);
  } catch {
    return null;
  }
}

function extractConfigMediaUrl(config, baseUrl = '') {
  if (!config || typeof config !== 'object') return null;
  const candidates = [];
  if (typeof config.source === 'string') candidates.push(config.source);
  if (typeof config.direct_access_url === 'string') candidates.push(config.direct_access_url);
  if (Array.isArray(config.fallback)) {
    for (const entry of config.fallback) {
      if (entry && typeof entry.file === 'string') candidates.push(entry.file);
    }
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = new URL(candidate, baseUrl || undefined).toString();
      if (isValidMediaUrl(resolved)) return resolved;
    } catch {
      continue;
    }
  }
  return null;
}

function extractPlayableMedia(html, baseUrl = '') {
  const config = extractEncodedConfig(html);
  const mediaUrl = config ? extractConfigMediaUrl(config, baseUrl) : null;
  if (!mediaUrl) return null;
  return {
    mediaUrl,
    type: detectStreamType(mediaUrl),
    headers: {},
  };
}

function isValidMediaUrl(candidate) {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // Reject static assets (scripts, styles, images) which are never video streams.
    // This prevents ALTCHA challenge pages (altcha.min.js) from being mistaken for media.
    if (/\.(js|css|php|html?|json|xml|png|jpe?g|gif|svg|woff2?|ico)(?:[?#]|$)/i.test(url.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function extractRedirectUrl(text, baseUrl = '') {
  const source = normalizeJsEscapes(text);
  const matches = [source.match(REDIRECT_RE), source.match(REPLACE_RE)];
  for (const match of matches) {
    if (match && match[1]) {
      try {
        return new URL(match[1], baseUrl || undefined).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractMediaCandidate(text, baseUrl = '', options = {}) {
  const { allowGenericUrl = true } = options;
  const source = normalizeJsEscapes(text);
  const patterns = [SOURCE_RE, FILE_RE, SRC_RE];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match || !match[1]) continue;
    const candidate = match[1].trim();
    if (BLOCKED_MEDIA_RE.test(candidate)) return null;
    try {
      const resolved = new URL(candidate, baseUrl || undefined).toString();
      if (isValidMediaUrl(resolved)) return resolved;
    } catch {
      continue;
    }
  }

  if (!allowGenericUrl) return null;

  const urlMatch = source.match(URL_RE);
  if (!urlMatch) return null;
  const candidate = urlMatch[0].trim();
  if (BLOCKED_MEDIA_RE.test(candidate)) return null;
  try {
    const resolved = new URL(candidate, baseUrl || undefined).toString();
    return isValidMediaUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function parseVoePage(html, pageUrl = '') {
  if (typeof html !== 'string' || !html.trim()) return null;

  const redirectUrl = extractRedirectUrl(html, pageUrl);
  const mediaUrl = extractConfigMediaUrl(extractEncodedConfig(html), pageUrl);

  if (!mediaUrl && !redirectUrl) return null;

  return {
    redirectUrl,
    mediaUrl,
    type: mediaUrl ? detectStreamType(mediaUrl) : 'unknown',
    headers: {},
  };
}

function parseVoeSource(response, baseUrl = '') {
  const body = typeof response === 'string'
    ? response
    : (response && (response.body ?? response.data ?? ''));
  if (typeof body !== 'string' || !body.trim()) return null;

  const playable = extractPlayableMedia(body, baseUrl);
  if (playable) return playable;

  const mediaUrl = extractMediaCandidate(body, baseUrl);
  if (!mediaUrl) return null;

  return {
    mediaUrl,
    type: detectStreamType(mediaUrl),
    headers: {},
  };
}

module.exports = {
  normalizeJsEscapes,
  rot13,
  decodeVoeConfig,
  extractEncodedConfig,
  extractConfigMediaUrl,
  extractPlayableMedia,
  isValidMediaUrl,
  extractRedirectUrl,
  extractMediaCandidate,
  parseVoePage,
  parseVoeSource,
};
