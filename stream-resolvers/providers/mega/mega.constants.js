'use strict';

const MEGA_HOST = 'mega.nz';
const MEGA_API_HOST = 'g.api.mega.co.nz';
const MEGA_API_BASE = 'https://g.api.mega.co.nz';
const MEGA_TIMEOUT_MS = 15000;
const MEGA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MEGA_MAX_API_REQUESTS = 5;
const MEGA_MAX_REDIRECTS = 5;

const MEGA_FILENAME_RE = /^\/(?:file|folder|embed)\/([A-Za-z0-9_-]+)(?:\/|$)/;
const MEGA_FILE_PATH_RE = /^\/(?:file|embed)\/([A-Za-z0-9_-]+)\/?$/;
const MEGA_FOLDER_PATH_RE = /^\/(?:folder|embed)\/([A-Za-z0-9_-]+)(?:\/.*)?$/;
const MEGA_KEY_RE = /^[A-Za-z0-9_-]+$/;

const MEGA_SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.mkv',
  '.m4v',
  '.mov',
];

const MEGA_SUPPORTED_VIDEO_EXT_RE = new RegExp(
  `\\.(${MEGA_SUPPORTED_VIDEO_EXTENSIONS.map((ext) => ext.slice(1)).join('|')})$`,
  'i'
);

module.exports = {
  MEGA_HOST,
  MEGA_API_HOST,
  MEGA_API_BASE,
  MEGA_TIMEOUT_MS,
  MEGA_USER_AGENT,
  MEGA_MAX_API_REQUESTS,
  MEGA_MAX_REDIRECTS,
  MEGA_FILENAME_RE,
  MEGA_FILE_PATH_RE,
  MEGA_FOLDER_PATH_RE,
  MEGA_KEY_RE,
  MEGA_SUPPORTED_VIDEO_EXTENSIONS,
  MEGA_SUPPORTED_VIDEO_EXT_RE,
  USER_AGENT: MEGA_USER_AGENT,
};