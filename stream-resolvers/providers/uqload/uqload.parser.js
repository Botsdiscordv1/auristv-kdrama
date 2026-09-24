'use strict';

const { URL } = require('url');

const { detectStreamType } = require('../../core/resolver.utils');
const { MAX_MEDIA_URL_LENGTH } = require('./uqload.constants');

const SCRIPT_TAG_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const PACKER_RE = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?return\s*p\}?\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\s*\(\s*['"][|]['"]\s*\)/;

const PLAYER_SETUP_RE = /jwplayer\s*\(\s*["'`]vplayer["'`]\s*\)\s*\.\s*setup\s*\(\s*\{/i;
const SOURCES_BLOCK_RE = /sources\s*:\s*\[\s*([\s\S]*?)\s*\]/i;
const FILE_ENTRY_RE = /(?:file|url|src)\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
const VIDEO_SRC_RE = /<\s*video\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const SOURCE_TAG_RE = /<\s*source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const MEDIA_URL_RE = /(?:https?:)?\/\/[^"'\s<>]*(?:\.m3u8|\.mp4|\.mpd|\.webm|\.mkv|\.mov|\.m4v)(?:\?[^"'\s<>]*)?|^\/(?:[^"'\s<>]*)(?:\.m3u8|\.mp4|\.mpd|\.webm|\.mkv|\.mov|\.m4v)(?:\?[^"'\s<>]*)?/gi;

const BLOCKED_SCHEME_RE = /^(blob:|data:|javascript:|file:)/i;
const NON_MEDIA_EXT_RE = /\.(jpe?g|png|gif|webp|css|js|ico|svg|woff2?|ttf|eot|vtt|srt|json|xml|txt|html)(?:$|[?#])/i;
const BLOCKED_HOST_RE = /(analytics|doubleclick|googletag|gtag|adservice|adsby|cloudflare|cdnjs|gstatic|googleapis|googletagmanager|sharethis|addthis|facebook|twitter|x\.com)/i;

function normalizeJsEscapes(value) {
  return String(value || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .trim();
}

function decodePacked(html) {
  const match = html.match(PACKER_RE);
  if (!match) return null;
  const base = Number(match[2]);
  const count = Number(match[3]);
  const dict = match[4].split('|');
  let out = match[1];
  for (let key = count - 1; key >= 0; key--) {
    if (key >= dict.length) continue;
    const word = dict[key];
    if (!word) continue;
    out = out.replace(new RegExp('\\b' + key.toString(base) + '\\b', 'g'), word);
  }
  return out;
}

function extractScriptBodies(html) {
  const bodies = [];
  const re = new RegExp(SCRIPT_TAG_RE.source, 'gi');
  let m;
  while ((m = re.exec(html))) {
    if (m[1] && m[1].trim()) bodies.push(m[1]);
  }
  return bodies;
}

function resolveCandidate(candidate, baseUrl = '') {
  const value = normalizeJsEscapes(candidate);
  if (!value || BLOCKED_SCHEME_RE.test(value)) return null;
  if (value.length > MAX_MEDIA_URL_LENGTH) return null;
  let target = value;
  if (target.startsWith('//')) target = `https:${target}`;
  let resolved;
  try {
    resolved = new URL(target, baseUrl || undefined).toString();
  } catch {
    return null;
  }
  if (!isValidMediaUrl(resolved)) return null;
  return resolved;
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
  if (BLOCKED_HOST_RE.test(host)) return true;
  return NON_MEDIA_EXT_RE.test(parsed.pathname);
}

function hasMediaExtension(value) {
  const path = String(value || '').split('?')[0].split('#')[0];
  return /\.(m3u8|mp4|mpd|webm|mkv|mov|m4v)$/i.test(path);
}

function collectFromPlayerConfig(html, baseUrl = '') {
  const out = [];
  const setupMatch = html.match(PLAYER_SETUP_RE);
  if (!setupMatch) return out;
  const from = setupMatch.index;
  const block = html.slice(from, from + 4000);
  const sources = block.match(SOURCES_BLOCK_RE);
  if (!sources) return out;
  const fileRe = new RegExp(FILE_ENTRY_RE.source, 'g');
  let m;
  while ((m = fileRe.exec(sources[1])) !== null) {
    const value = m[1] || m[2] || m[3] || '';
    const resolved = resolveCandidate(value, baseUrl);
    if (resolved && hasMediaExtension(resolved)) out.push(resolved);
  }
  return out;
}

function collectFromHtmlTags(html, baseUrl = '') {
  const out = [];
  const sourceRe = new RegExp(SOURCE_TAG_RE.source, 'gi');
  let m;
  while ((m = sourceRe.exec(html)) !== null) {
    const resolved = resolveCandidate(m[1], baseUrl);
    if (resolved) out.push(resolved);
  }
  const videoRe = new RegExp(VIDEO_SRC_RE.source, 'gi');
  while ((m = videoRe.exec(html)) !== null) {
    const resolved = resolveCandidate(m[1], baseUrl);
    if (resolved) out.push(resolved);
  }
  return out;
}

function collectFromMediaUrls(text, baseUrl = '') {
  const out = [];
  const re = new RegExp(MEDIA_URL_RE.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const resolved = resolveCandidate(m[0], baseUrl);
    if (resolved) out.push(resolved);
  }
  return out;
}

function unique(results) {
  return [...new Set(results.filter(Boolean))];
}

function selectBest(candidates) {
  let fallback = null;
  for (const candidate of candidates) {
    if (!hasMediaExtension(candidate)) continue;
    if (isIrrelevantMediaUrl(candidate)) continue;
    const path = candidate.split('?')[0].toLowerCase();
    if (path.endsWith('.m3u8')) return candidate;
    if (path.endsWith('.mpd')) fallback = candidate;
    else if (!fallback) fallback = candidate;
  }
  return fallback;
}

function buildHeaders(mediaUrl) {
  return {};
}

function parseUqloadPage(html, pageUrl = '') {
  if (typeof html !== 'string' || !html.trim()) return null;

  const scripts = extractScriptBodies(html);
  const unpacked = scripts.map((script) => decodePacked(script)).filter(Boolean);
  const texts = [...scripts, ...unpacked, html];
  const playerText = [...scripts, ...unpacked].join('\n');

  const candidates = unique([
    ...collectFromPlayerConfig(playerText, pageUrl),
    ...texts.flatMap((text) => collectFromMediaUrls(text, pageUrl)),
    ...collectFromHtmlTags(html, pageUrl),
  ]);

  if (candidates.length === 0) return null;

  const mediaUrl = selectBest(candidates);
  if (!mediaUrl) return null;

  return {
    mediaUrl,
    type: detectStreamType(mediaUrl),
    headers: buildHeaders(mediaUrl),
  };
}

module.exports = {
  normalizeJsEscapes,
  decodePacked,
  extractScriptBodies,
  resolveCandidate,
  isValidMediaUrl,
  isIrrelevantMediaUrl,
  hasMediaExtension,
  collectFromPlayerConfig,
  collectFromHtmlTags,
  collectFromMediaUrls,
  selectBest,
  parseUqloadPage,
};