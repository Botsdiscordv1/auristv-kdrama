'use strict';

const { URL } = require('url');

const {
  MEGA_KEY_RE,
  MEGA_FILE_PATH_RE,
  MEGA_FOLDER_PATH_RE,
} = require('./mega.constants');

function normalizeInputUrl(inputUrl) {
  const url = new URL(inputUrl);
  return url.toString();
}

function parseMegaUrl(inputUrl) {
  if (typeof inputUrl !== 'string') return null;
  let url;
  try {
    url = new URL(inputUrl.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'mega.nz' && !host.endsWith('.mega.nz')) return null;

  const path = url.pathname;
  const hash = url.hash;

  // New format (2020+): /file/<id>#<key>  |  /folder/<id>#<key>
  if (path && path.startsWith('/')) {
    const fileMatch = path.match(MEGA_FILE_PATH_RE);
    if (fileMatch) {
      const key = hash.length > 0 ? hash.slice(1) : '';
      if (!key || !MEGA_KEY_RE.test(key)) return null;
      const fileId = fileMatch[1];
      if (!fileId) return null;
      return { type: 'file', fileId, key };
    }

    const folderMatch = path.match(MEGA_FOLDER_PATH_RE);
    if (folderMatch) {
      const key = hash.length > 0 ? hash.slice(1).split('/')[0] : '';
      return { type: 'folder', fileId: folderMatch[1], key: key || null };
    }
  }

  // Legacy format: /#!<id>!<key>  |  /#F!<id>!<key>
  if (path === '/' && hash && hash.length > 1) {
    const parts = hash.split('!');
    if (parts[0] === '#') {
      if (parts.length < 2) return null;
      const fileId = parts[1];
      const key = parts[2] || '';
      if (!fileId || !key || !MEGA_KEY_RE.test(key)) return null;
      return { type: 'file', fileId, key };
    }
    if (parts[0] === '#F') {
      if (parts.length < 2) return null;
      return { type: 'folder', fileId: parts[1], key: parts[2] || null };
    }
  }

  return null;
}

function isMegaUrl(inputUrl) {
  if (typeof inputUrl !== 'string') return false;
  try {
    const url = new URL(inputUrl);
    const host = url.hostname.toLowerCase();
    return host === 'mega.nz' || host.endsWith('.mega.nz');
  } catch {
    return false;
  }
}

module.exports = {
  normalizeInputUrl,
  parseMegaUrl,
  isMegaUrl,
};