'use strict';

const { URL } = require('url');

const { detectStreamType } = require('../../core/resolver.utils');

const PLAYER_SRC_RE = /player\.src\(\s*\{[\s\S]*?\bsrc\s*:\s*["']([^"']+)["']/i;
const SOURCE_TAG_RE = /<\s*source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const VIDEO_SRC_RE = /<\s*video\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const FILE_ASSIGN_RE = /(?:^|[^\w$)])file\s*[:=]\s*["']([^"']+)["']/gi;

const BLOCKED_SCHEME_RE = /^(blob:|data:|javascript:|file:)/i;
const NON_MEDIA_EXT_RE = /\.(jpe?g|png|gif|webp|css|js|ico|svg|woff2?|ttf|eot|json|xml|txt)(?:$|[?#])/i;
const BLOCKED_HOST_RE = /(analytics|doubleclick|googletag|gtag|adservice|adsby|cloudflare|cdnjs|gstatic|googleapis|googletagmanager)/i;

function normalizeJsEscapes(value) {
  return String(value || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .trim();
}

function isValidMediaUrl(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isIrrelevantMediaUrl(candidate) {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (NON_MEDIA_EXT_RE.test(path)) return true;
  if (BLOCKED_HOST_RE.test(host)) return true;
  return false;
}

function resolveCandidate(candidate, baseUrl = '') {
  const value = normalizeJsEscapes(candidate);
  if (!value || BLOCKED_SCHEME_RE.test(value)) return null;
  try {
    const resolved = new URL(value, baseUrl || undefined).toString();
    return isValidMediaUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function unique(results) {
  return [...new Set(results.filter(Boolean))];
}

function collectFromPlayerConfig(html, baseUrl = '') {
  const match = html.match(PLAYER_SRC_RE);
  if (!match || !match[1]) return [];
  const resolved = resolveCandidate(match[1], baseUrl);
  return resolved ? [resolved] : [];
}

function collectFromHtmlTags(html, baseUrl = '') {
  const out = [];
  let match;
  const sourceRe = new RegExp(SOURCE_TAG_RE.source, 'gi');
  while ((match = sourceRe.exec(html)) !== null) {
    const resolved = resolveCandidate(match[1], baseUrl);
    if (resolved) out.push(resolved);
  }
  const videoRe = new RegExp(VIDEO_SRC_RE.source, 'gi');
  while ((match = videoRe.exec(html)) !== null) {
    const resolved = resolveCandidate(match[1], baseUrl);
    if (resolved) out.push(resolved);
  }
  return out;
}

function collectFromScriptAssignments(html, baseUrl = '') {
  const out = [];
  let match;
  const fileRe = new RegExp(FILE_ASSIGN_RE.source, 'gi');
  while ((match = fileRe.exec(html)) !== null) {
    const resolved = resolveCandidate(match[1], baseUrl);
    if (resolved) out.push(resolved);
  }
  return out;
}

function selectBest(candidates) {
  for (const candidate of candidates) {
    if (isValidMediaUrl(candidate) && !isIrrelevantMediaUrl(candidate)) return candidate;
  }
  return null;
}

function buildReferer(baseUrl = '') {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.hostname}/`;
  } catch {
    return '';
  }
}

function extractPlayableMedia(html, baseUrl = '') {
  if (typeof html !== 'string' || !html.trim()) return null;
  const candidates = unique([
    ...collectFromPlayerConfig(html, baseUrl),
    ...collectFromHtmlTags(html, baseUrl),
    ...collectFromScriptAssignments(html, baseUrl),
  ]);
  const mediaUrl = selectBest(candidates);
  if (!mediaUrl) return null;
  return {
    mediaUrl,
    type: detectStreamType(mediaUrl),
    headers: {
      Referer: buildReferer(baseUrl),
    },
  };
}

function parseMp4Upload(html, pageUrl = '') {
  if (typeof html !== 'string' || !html.trim()) return null;
  return extractPlayableMedia(html, pageUrl);
}

module.exports = {
  normalizeJsEscapes,
  isValidMediaUrl,
  isIrrelevantMediaUrl,
  resolveCandidate,
  extractPlayableMedia,
  parseMp4Upload,
};