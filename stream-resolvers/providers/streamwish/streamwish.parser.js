'use strict';

const { URL } = require('url');

const { EMBED_HOSTS, EMBED_PATH_RE } = require('./streamwish.constants');

const SCRIPT_TAG_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const PACKER_RE = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?return\s*p\}?\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\s*\(\s*['"][|]['"]\s*\)/;
const SOURCES_RE = /sources\s*:\s*\[\s*([\s\S]*?)\s*\]/i;
const FILE_RE = /(?:file|url)\s*:\s*(?:"([^"]+)"|'([^']+)'|([^,}\]]+))/g;
const MEDIA_RE = /(?:https?:)?\/\/[^"'\s<>]*(?:\.m3u8|\.mp4|\.mpd|\.webm|\.mkv|master\.txt)(?:\?[^"'\s<>]*)?|^\/[^"'\s<>]*\.(?:m3u8|mp4|mpd|webm|mkv|txt)(?:\?[^"'\s<>]*)?/gi;

function normalizeJsEscapes(value) {
  return String(value || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
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

function resolveCandidate(candidate, pageUrl) {
  if (typeof candidate !== 'string' || !candidate) return null;
  if (/^(javascript:|data:|file:|blob:)/i.test(candidate.trim())) return null;
  let target = normalizeJsEscapes(candidate.trim());
  if (target.startsWith('//')) target = `https:${target}`;
  let absolute;
  try {
    absolute = new URL(target, pageUrl || undefined).toString();
  } catch {
    return null;
  }
  try {
    const parsed = new URL(absolute);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return absolute;
}

function isMediaCandidate(candidate) {
  if (typeof candidate !== 'string') return false;
  const clean = normalizeJsEscapes(candidate).split('?')[0];
  return /\.(m3u8|mp4|mpd|webm|mkv|txt)$/i.test(clean) || /master\.txt$/i.test(clean);
}

function extractCandidates(text, pageUrl) {
  const candidates = [];
  const seen = new Set();

  const push = (raw) => {
    const resolved = resolveCandidate(raw, pageUrl);
    if (!resolved || !isMediaCandidate(resolved)) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  const sourceMatch = text.match(SOURCES_RE);
  if (sourceMatch) {
    const block = sourceMatch[1];
    const fileRe = new RegExp(FILE_RE.source, 'g');
    let fm;
    while ((fm = fileRe.exec(block))) {
      const value = (fm[1] || fm[2] || fm[3] || '').trim();
      if (!value) continue;
      if (value.includes('||') || /\blinks?\./i.test(value)) continue;
      push(value);
    }
  }

  const mediaRe = new RegExp(MEDIA_RE.source, 'gi');
  let mm;
  while ((mm = mediaRe.exec(text))) {
    push(mm[0].replace(/^["'=:,\s]+/, '').replace(/[,"'\s]+$/, ''));
  }

  return candidates;
}

function parseStreamWish(html, pageUrl = '') {
  if (typeof html !== 'string' || !html) return null;

  const scripts = extractScriptBodies(html);
  const unpacked = scripts.map((script) => decodePacked(script)).filter(Boolean);
  const texts = [...scripts, ...unpacked];

  const seen = new Set();
  const candidates = [];
  for (const text of texts) {
    for (const candidate of extractCandidates(normalizeJsEscapes(text), pageUrl)) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) return null;

  const score = (url) => {
    const clean = normalizeJsEscapes(url).split('?')[0];
    let value = 0;
    if (/^https:\/\//i.test(url)) value += 4;
    if (/\.m3u8$/i.test(clean)) value += 3;
    if (/master\.txt$/i.test(clean)) value += 2;
    if (/\.mpd$/i.test(clean)) value += 2;
    if (/\.(mp4|webm|mkv)$/i.test(clean)) value += 1;
    return value;
  };

  candidates.sort((a, b) => score(b) - score(a));
  const mediaUrl = candidates[0];
  const clean = normalizeJsEscapes(mediaUrl).split('?')[0];
  const type = /\.mpd$/i.test(clean) ? 'dash' : /\.(m3u8|txt)$/i.test(clean) ? 'hls' : 'mp4';

  return { mediaUrl, type, headers: {} };
}

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

module.exports = {
  parseStreamWish,
  decodePacked,
  extractScriptBodies,
  extractCandidates,
  resolveCandidate,
  normalizeJsEscapes,
  isStreamWishHost,
  isStreamWishUrl,
  extractStreamWishId,
};
