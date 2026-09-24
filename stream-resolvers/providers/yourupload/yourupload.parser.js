'use strict';

const { YOURUPLOAD_HOSTS, WATCH_PATH_RE, EMBED_PATH_RE, DOWNLOAD_FILE_RE, DOWNLOAD_TOKEN_RE } = require('./yourupload.constants');

function isYourUploadHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return YOURUPLOAD_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function isYourUploadUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isYourUploadHost(parsed.hostname);
}

function extractYourUploadId(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const watch = parsed.pathname.match(WATCH_PATH_RE);
  if (watch) return watch[1];
  const embed = parsed.pathname.match(EMBED_PATH_RE);
  if (embed) return embed[1];
  return null;
}

function toYourUploadWatchUrl(url, videoId) {
  const parsed = new URL(url);
  parsed.pathname = `/watch/${videoId}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function toYourUploadDownloadUrl(baseUrl, fileId) {
  const parsed = new URL(baseUrl);
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = '/download';
  parsed.search = new URLSearchParams({ file: String(fileId) }).toString();
  return parsed.toString();
}

function parseYourUploadWatchPage(html) {
  if (typeof html !== 'string' || html.length === 0) return null;
  const fileMatch = html.match(DOWNLOAD_FILE_RE);
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const fileId = fileMatch ? fileMatch[1] : null;
  if (!fileId) return null;
  return {
    fileId,
    title: titleMatch ? titleMatch[1].trim() : null,
  };
}

function parseYourUploadDownloadPage(html) {
  if (typeof html !== 'string' || html.length === 0) return null;
  const tokenMatch = html.match(DOWNLOAD_TOKEN_RE);
  if (!tokenMatch) return null;
  return { token: tokenMatch[1] };
}

function extractConnectSidCookie(setCookie) {
  if (!setCookie) return null;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of list) {
    const match = /^\s*connect\.sid=([^;]+)/i.exec(raw || '');
    if (match) return `connect.sid=${match[1]}`;
  }
  return null;
}

module.exports = {
  isYourUploadHost,
  isYourUploadUrl,
  extractYourUploadId,
  toYourUploadWatchUrl,
  toYourUploadDownloadUrl,
  parseYourUploadWatchPage,
  parseYourUploadDownloadPage,
  extractConnectSidCookie,
};