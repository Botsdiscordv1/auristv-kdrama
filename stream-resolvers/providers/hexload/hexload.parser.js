'use strict';

const { URL } = require('url');

const { EMBED_HOSTS, EMBED_PATH_RE } = require('./hexload.constants');
const { detectStreamType } = require('../../core/resolver.utils');

const SCRIPT_TAG_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const AJAX_URL_RE = /url\s*:\s*['"]([^'"]+)['"]/i;
const DATA_OP_RE = /op\s*:\s*['"]([^'"]+)['"]/i;
const DATA_ID_RE = /id\s*:\s*['"]([^'"]+)['"]/i;
const MEDIA_URL_RE = /(?:https?:)?\/\/[^"'\s<>]*(?:\.m3u8|\.mp4|\.mpd|\.webm|\.mkv)(?:\?[^"'\s<>]*)?/gi;

function isHexloadHost(hostname) {
  return EMBED_HOSTS.includes((hostname || '').toLowerCase());
}

function isHexloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isHexloadHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractHexloadFileId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isHexloadHost(parsed.hostname)) return null;
  const match = parsed.pathname.match(EMBED_PATH_RE);
  return match ? match[1] : null;
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

function parsePlayerConfig(html, pageUrl = '') {
  if (typeof html !== 'string' || !html) return null;

  for (const script of extractScriptBodies(html)) {
    if (!/download/i.test(script) || !/op\s*:/i.test(script)) continue;

    let endpoint = '';
    const urlMatch = script.match(AJAX_URL_RE);
    if (urlMatch) endpoint = urlMatch[1].trim();

    let op = '';
    const opMatch = script.match(DATA_OP_RE);
    if (opMatch) op = opMatch[1].trim();

    let id = '';
    const idMatch = script.match(DATA_ID_RE);
    if (idMatch) id = idMatch[1].trim();

    if (!endpoint && pageUrl) endpoint = `${new URL(pageUrl).origin}/download`;
    if (!endpoint) continue;

    let absolute;
    try {
      absolute = new URL(endpoint, pageUrl || undefined).toString();
    } catch {
      continue;
    }
    if (absolute.startsWith('http:') || absolute.startsWith('https:')) {
      return { endpoint: absolute, op: op || null, id: id || null };
    }
  }
  return null;
}

function findMediaCandidates(text, pageUrl = '') {
  const candidates = [];
  const seen = new Set();
  const re = new RegExp(MEDIA_URL_RE.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    let raw = m[0].replace(/^["'=:,\s]+/, '').replace(/[,"'\s]+$/, '');
    if (raw.startsWith('//')) raw = `https:${raw}`;
    let absolute;
    try {
      absolute = new URL(raw, pageUrl || undefined).toString();
    } catch {
      continue;
    }
    const parsed = new URL(absolute);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    candidates.push(absolute);
  }
  return candidates;
}

function findHlsSource(text, pageUrl = '') {
  const candidates = findMediaCandidates(text, pageUrl);
  return candidates.find((url) => /\.m3u8($|[?#])/i.test(url.split('?')[0])) || null;
}

function findMp4Source(text, pageUrl = '') {
  const candidates = findMediaCandidates(text, pageUrl);
  return candidates.find((url) => /\.(mp4|m4v|mov|webm|mkv)($|[?#])/i.test(url.split('?')[0])) || null;
}

function findVideoSource(downloadBody) {
  if (typeof downloadBody !== 'string' || !downloadBody.trim()) return null;

  let payload;
  try {
    payload = JSON.parse(downloadBody);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || payload.msg !== 'OK') return null;

  const result = payload.result;
  if (!result || typeof result !== 'object') return null;
  if (typeof result.url !== 'string' || !result.url.trim()) return null;

  const rawUrl = result.url.trim();
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const contentType = typeof result.content_type === 'string' ? result.content_type : '';
  const type = detectStreamType(rawUrl, contentType);
  return {
    url: rawUrl,
    type: type === 'unknown' ? 'mp4' : type,
    contentType,
    fileName: typeof result.file_name === 'string' ? result.file_name : null,
    size: typeof result.size === 'number' ? result.size : null,
  };
}

module.exports = {
  parsePlayerConfig,
  findVideoSource,
  findHlsSource,
  findMp4Source,
  findMediaCandidates,
  extractScriptBodies,
  isHexloadHost,
  isHexloadUrl,
  extractHexloadFileId,
};
