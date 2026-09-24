'use strict';

const { URL } = require('url');

const { EMBED_HOSTS, EMBED_PATH_RE } = require('./vidhide.constants');

const SCRIPT_TAG_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const PACKER_BODY_RE =
  /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?return\s*p\}?\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\s*\(\s*['"][|]['"]\s*\)/;
const SOURCES_RE = /sources\s*:\s*\[\s*((?:[^\[\]]|\[[^\]]*\])*)\s*\]/i;
const FILE_REF_RE = /(?:file|url)\s*:\s*(?:"([^"]+)"|'([^']+)'|([^,}\s]+))/g;
const MEDIA_URL_RE = /(?:https?:)?\/\/[^"'\s<>]*(?:\.m3u8|\.mp4|\.mpd|\.webm|\.mkv|master\.txt)(?:\?[^"'\s<>]*)?|^\/[^"'\s<>]*\.(?:m3u8|mp4|mpd|webm|mkv|txt)(?:\?[^"'\s<>]*)?/gi;

function decodePacked(html) {
  const match = html.match(PACKER_BODY_RE);
  if (!match) return null;
  const base = Number(match[2]);
  const count = Number(match[3]);
  const dict = match[4].split('|');
  let out = match[1];
  for (let key = count - 1; key >= 0; key--) {
    if (key >= dict.length) continue;
    const word = dict[key];
    if (word === undefined || word === '') continue;
    const token = key.toString(base);
    out = out.replace(new RegExp('\\b' + token + '\\b', 'g'), word);
  }
  return out;
}

function normalizeJsEscapes(value) {
  return String(value || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
}

function resolveCandidate(candidate, pageUrl) {
  if (typeof candidate !== 'string' || !candidate) return null;
  let target = candidate;
  if (target.startsWith('//')) target = `https:${target}`;
  const cleaned = normalizeJsEscapes(target);
  let absolute;
  try {
    absolute = new URL(cleaned, pageUrl || undefined).toString();
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return absolute;
}

function isMediaLike(candidate) {
  if (typeof candidate !== 'string') return false;
  return /\.(m3u8|mp4|mpd|webm|mkv|txt)(\?|$)/i.test(normalizeJsEscapes(candidate).split('?')[0]);
}

function extractCandidates(text, pageUrl) {
  const source = normalizeJsEscapes(text);
  const candidates = [];
  const seen = new Set();

  const push = (raw) => {
    const resolved = resolveCandidate(raw, pageUrl);
    if (!resolved || !isMediaLike(resolved)) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  const sourcesRe = new RegExp(SOURCES_RE.source, 'gi');
  let m;
  while ((m = sourcesRe.exec(source))) {
    const block = m[1];
    const fileRe = new RegExp(FILE_REF_RE.source, 'g');
    let fm;
    while ((fm = fileRe.exec(block))) {
      const value = (fm[1] || fm[2] || fm[3] || '').trim();
      push(value);
    }
  }

  const mediaRe = new RegExp(MEDIA_URL_RE.source, 'gi');
  let mm;
  while ((mm = mediaRe.exec(source))) {
    push(mm[0].replace(/^["'=:,\s]+/, '').replace(/[,"'\s]+$/, ''));
  }

  return candidates;
}

function extractScriptBodies(html) {
  const bodies = [];
  let m;
  const re = new RegExp(SCRIPT_TAG_RE.source, 'gi');
  while ((m = re.exec(html))) {
    if (m[1] && m[1].trim()) bodies.push(m[1]);
  }
  return bodies;
}

function parseVidHide(html, pageUrl = '') {
  if (typeof html !== 'string' || !html) return null;

  const scripts = extractScriptBodies(html);
  const unpacked = scripts.map(decodeIfPacked).filter(Boolean);
  const texts = [...scripts, ...unpacked];

  const seen = new Set();
  const candidates = [];
  for (const text of texts) {
    for (const c of extractCandidates(text, pageUrl)) {
      if (!seen.has(c)) {
        seen.add(c);
        candidates.push(c);
      }
    }
  }

  const preference = (url) => {
    let score = 0;
    const clean = normalizeJsEscapes(url).split('?')[0];
    if (/^https:\/\//i.test(url)) score += 4;
    if (/\.m3u8/i.test(clean)) score += 3;
    if (/\.mpd/i.test(clean)) score += 2;
    if (/\.(mp4|webm|mkv)/i.test(clean)) score += 2;
    if (/master\.txt/i.test(clean)) score += 1;
    return score;
  };

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => preference(b) - preference(a));

  const chosen = candidates[0];

  return {
    mediaUrl: chosen,
    type: /\.(m3u8|txt)/i.test(normalizeJsEscapes(chosen).split('?')[0]) ? 'hls' : /\.mpd/i.test(chosen) ? 'dash' : 'mp4',
    headers: {},
  };
}

function decodeIfPacked(script) {
  return decodePacked(script);
}

function hasPackedScript(html) {
  return typeof html === 'string' && PACKER_BODY_RE.test(html);
}

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

module.exports = {
  parseVidHide,
  decodePacked,
  decodeIfPacked,
  extractScriptBodies,
  extractCandidates,
  resolveCandidate,
  normalizeJsEscapes,
  isVidHideHost,
  isVidHideUrl,
  extractVidHideId,
  hasPackedScript,
};
