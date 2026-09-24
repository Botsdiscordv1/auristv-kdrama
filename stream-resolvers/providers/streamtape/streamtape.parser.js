'use strict';

const { URL } = require('url');

const { EMBED_HOSTS, EMBED_PATH_RE } = require('./streamtape.constants');

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");
}

function extractNorobotExpression(html) {
  const assignRe = /document\.getElementById\s*\(\s*['"]([\w-]*)norobotlink?['"]\s*\)\s*\.innerHTML\s*=\s*([\s\S]+?);/;
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let block;
  while ((block = scriptRe.exec(html))) {
    const match = assignRe.exec(block[1]);
    if (match && typeof match[2] === 'string') {
      return match[2].trim();
    }
  }
  return null;
}

function readStringLiteral(src, quote, start) {
  let i = start;
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const next = src[i + 1];
      if (next === undefined) return null;
      out += next;
      i += 2;
      continue;
    }
    if (c === quote) return { value: out, end: i + 1 };
    out += c;
    i += 1;
  }
  return null;
}

function decodeStreamTapeCode(expr) {
  if (typeof expr !== 'string' || !expr) return null;
  let out = '';
  let lastPart = '';
  let i = 0;
  const src = expr;
  const isWs = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r';

  while (i < src.length) {
    const c = src[i];
    if (isWs(c)) {
      i += 1;
      continue;
    }
    if (c === '(' || c === ')') {
      i += 1;
      continue;
    }
    if (c === '+') {
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const literal = readStringLiteral(src, c, i + 1);
      if (!literal) return null;
      i = literal.end;
      out += literal.value;
      lastPart = literal.value;
      continue;
    }
    if (c === '.') {
      if (!src.startsWith('.substring', i)) return null;
      let j = i + '.substring'.length;
      while (isWs(src[j])) j += 1;
      if (src[j] !== '(') return null;
      let k = j + 1;
      while (isWs(src[k])) k += 1;
      if (!/\d/.test(src[k])) return null;
      let num = '';
      while (k < src.length && /\d/.test(src[k])) {
        num += src[k];
        k += 1;
      }
      while (isWs(src[k])) k += 1;
      if (src[k] !== ')') return null;
      const cut = lastPart.slice(Number(num));
      out = out.slice(0, out.length - lastPart.length) + cut;
      lastPart = cut;
      i = k + 1;
      continue;
    }
    return null;
  }
  return out;
}

function resolveMediaUrl(raw, pageUrl) {
  if (typeof raw !== 'string' || !raw) return null;
  let target = raw;
  if (target.startsWith('//')) target = `https:${target}`;
  let absolute;
  try {
    absolute = new URL(target, pageUrl || undefined).toString();
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

function streamTypeFromUrl(url) {
  const path = (url || '').split('?')[0].toLowerCase();
  if (path.endsWith('.m3u8') || path.includes('.m3u8')) return 'hls';
  if (path.endsWith('.mpd')) return 'dash';
  return 'mp4';
}

function parseStreamTape(html, pageUrl) {
  if (typeof html !== 'string' || !html) return null;
  const expression = extractNorobotExpression(html);
  if (!expression) return null;
  const decoded = decodeStreamTapeCode(expression);
  if (!decoded) return null;
  const raw = decodeEntities(decoded);
  if (!raw) return null;
  const mediaUrl = resolveMediaUrl(raw, pageUrl);
  if (!mediaUrl) return null;
  return {
    mediaUrl,
    type: streamTypeFromUrl(mediaUrl),
    headers: {},
  };
}

function isStreamTapeHost(hostname) {
  return EMBED_HOSTS.includes((hostname || '').toLowerCase());
}

function isStreamTapeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isStreamTapeHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractStreamTapeId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'e' && segments[0] !== 'v') return null;
  const id = segments[1] || '';
  return /^[a-zA-Z0-9]+$/.test(id) ? id : null;
}

module.exports = {
  parseStreamTape,
  extractNorobotExpression,
  decodeStreamTapeCode,
  decodeEntities,
  resolveMediaUrl,
  streamTypeFromUrl,
  isStreamTapeHost,
  isStreamTapeUrl,
  extractStreamTapeId,
};