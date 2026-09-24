'use strict';

const { URL } = require('url');

const { EMBED_HOSTS, EMBED_PATH_RE } = require('./dood.constants');

const PASS_MD5_RE = /\/pass_md5\/[^'"\s<>]+/i;
const TITLE_QUALITY_RE = /(\d{3,4}[pP])/;
const NOT_FOUND_RE = /(file\s+was\s+deleted|file\s+not\s+found|not\s+found|removed|doesn't\s+exist)/i;
const BLOCKED_RE = /(access\s+denied|blocked|captcha|disabled|forbidden)/i;

function normalizeJsEscapes(value) {
  return String(value || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&').trim();
}

function isDoodHost(hostname) {
  return EMBED_HOSTS.includes((hostname || '').toLowerCase());
}

function isDoodUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isDoodHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractDoodId(url) {
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

function extractPassMd5Path(html) {
  const match = String(html || '').match(PASS_MD5_RE);
  return match ? match[0] : null;
}

function extractQuality(html) {
  const match = String(html || '').match(/<title>([^<]+)<\/title>/i);
  if (!match) return null;
  const quality = match[1].match(TITLE_QUALITY_RE);
  return quality ? quality[1] : null;
}

function parseDoodPage(html, pageUrl = '') {
  if (typeof html !== 'string' || !html) return null;

  // La página de playmogo incluye templates HTML del bundle JS (div oculto
  // "Not Found", constantes "/embedblocked", CSS de captcha, etc.) que hacen
  // falso-positivo a los detectores de bloqueo. Si hay un path pass_md5 el
  // video existe y esos templates se ignoran.
  const passMd5Path = extractPassMd5Path(html);
  if (passMd5Path) {
    return {
      passMd5Path,
      quality: extractQuality(html),
    };
  }

  if (NOT_FOUND_RE.test(html)) return { notFound: true };
  if (BLOCKED_RE.test(html)) return { blocked: true };

  return null;
}

function isValidMediaUrl(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseDoodSource(response, baseUrl) {
  const text = normalizeJsEscapes(response);
  if (!text) return null;

  const trimmed = text.replace(/<[^>]+>/g, ' ').trim();
  if (!trimmed) return null;
  if (/^(blob:|javascript:|data:|file:)/i.test(trimmed)) return null;

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate) && !candidate.startsWith('/')) {
    const urlMatch = candidate.match(/https?:\/\/[^\s"'<>()]+/i);
    if (urlMatch) candidate = urlMatch[0];
  }

  let absolute;
  try {
    absolute = new URL(candidate, baseUrl || undefined).toString();
  } catch {
    return null;
  }

  if (!isValidMediaUrl(absolute)) return null;
  return {
    mediaUrl: absolute,
    type: 'mp4',
    headers: {},
  };
}

module.exports = {
  normalizeJsEscapes,
  isDoodHost,
  isDoodUrl,
  extractDoodId,
  extractPassMd5Path,
  extractQuality,
  parseDoodPage,
  parseDoodSource,
  isValidMediaUrl,
};
