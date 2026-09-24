'use strict';

const { URL } = require('url');

const { EMBED_HOSTS, EMBED_PATH_RE } = require('./savefiles.constants');

const SCRIPT_TAG_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const SETUP_FILE_RE = /(?:file|src|source)\s*:\s*(?:"([^"]+)"|'([^']+)')/gi;
const SOURCES_BLOCK_RE = /sources\s*:\s*\[\s*([\s\S]*?)\s*\]/i;
const URL_LITERAL_RE = /["']([^"']+)["']/g;
const MEDIA_URL_RE = /(?:https?:)?\/\/[^"'\s<>]*(?:\.m3u8|\.mpd|\.mp4|\.m4v|\.mov|\.webm|\.mkv)(?:\?[^"'\s<>]*)?/gi;
const PLAYER_VIDEO_RE = /["'](?:file|src|source|url|playlist|video|mp4|m3u8)["']\s*:\s*["']([^"']+)["']/gi;

function isSavefilesHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return EMBED_HOSTS.includes(host);
}

function isSavefilesUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isSavefilesHost(parsed.hostname) && EMBED_PATH_RE.test(parsed.pathname);
}

function extractSavefilesFileId(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isSavefilesHost(parsed.hostname)) return null;
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

function parsePlayerConfiguration(html, pageUrl = '') {
  if (typeof html !== 'string' || !html) return null;

  const config = {
    endpoint: null,
    file: null,
    sources: [],
    playerType: null,
    pageUrl: pageUrl || null,
  };

  if (/jwplayer|videojs|clappr|plyr|hls\.js|shaka|player\.setup/i.test(html)) {
    config.playerType = 'js-player';
  }

  const bodies = extractScriptBodies(html);
  const scan = (text) => {
    const sourcesBlock = text.match(SOURCES_BLOCK_RE);
    if (sourcesBlock) {
      let m;
      const re = new RegExp(URL_LITERAL_RE.source, 'g');
      while ((m = re.exec(sourcesBlock[1]))) {
        const candidate = m[1];
        if (/\.(m3u8|mpd|mp4|m4v|mov|webm|mkv)(\?|$)/i.test(candidate)) {
          config.sources.push(candidate);
        }
      }
    }
    let m;
    const re = new RegExp(SETUP_FILE_RE.source, 'g');
    while ((m = re.exec(text))) {
      const candidate = m[1] || m[2];
      if (candidate && !config.file) config.file = candidate;
    }
    const re2 = new RegExp(PLAYER_VIDEO_RE.source, 'g');
    let m2;
    while ((m2 = re2.exec(text))) {
      const candidate = m2[1];
      if (candidate && !config.file) config.file = candidate;
    }
  };

  for (const body of bodies) scan(body);
  scan(html);

  return config;
}

function findMediaCandidates(html, pageUrl = '') {
  const candidates = [];
  const seen = new Set();
  const re = new RegExp(MEDIA_URL_RE.source, 'gi');
  let m;
  while ((m = re.exec(html))) {
    let raw = m[0];
    if (raw.startsWith('//')) raw = `https:${raw}`;
    if (!/^https?:\/\//i.test(raw)) continue;
    let absolute;
    try {
      absolute = new URL(raw, pageUrl || undefined).toString();
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    candidates.push(absolute);
  }
  return candidates;
}

function findHlsSource(html, pageUrl = '') {
  const candidates = findMediaCandidates(html, pageUrl);
  return candidates.find((url) => /\.m3u8($|[?#])/i.test(url.split('?')[0])) || null;
}

function findMp4Source(html, pageUrl = '') {
  const candidates = findMediaCandidates(html, pageUrl);
  return candidates.find((url) => /\.(mp4|m4v|mov|webm|mkv)($|[?#])/i.test(url.split('?')[0])) || null;
}

function findVideoSource(html, pageUrl = '') {
  const hls = findHlsSource(html, pageUrl);
  if (hls) return { url: hls, type: 'hls' };
  const mp4 = findMp4Source(html, pageUrl);
  if (mp4) return { url: mp4, type: 'mp4' };
  return null;
}

module.exports = {
  isSavefilesHost,
  isSavefilesUrl,
  extractSavefilesFileId,
  parsePlayerConfiguration,
  findHlsSource,
  findMp4Source,
  findVideoSource,
  findMediaCandidates,
  extractScriptBodies,
};
