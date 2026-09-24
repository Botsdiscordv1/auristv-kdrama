'use strict';

const UPNSHARE_HOST_RE = /uns\.bio$/i;

// Player URLs use a per-account custom subdomain (e.g. animeav1.uns.bio) and
// carry the video id in the URL fragment: https://{domain}/#{videoId}
const PLAYER_URL_RE = /^https?:\/\/[^/]+\.uns\.bio\/?#([A-Za-z0-9_-]+)(?:\/.*)?$/i;

const PLAYER_FRAGMENT_RE = /#([A-Za-z0-9_-]+)/;

// Static AES-CBC credential shared by the UPnShare player (protocol string).
const PROTOCOL = 'kiemtienmua911ca';

// Initialization vectors are tried in order (same as the reference player).
const IV_CANDIDATES = Object.freeze(['1234567890oiuytr', '0123456789abcdef']);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const API_TIMEOUT_MS = 20000;

module.exports = {
  UPNSHARE_HOST_RE,
  PLAYER_URL_RE,
  PLAYER_FRAGMENT_RE,
  PROTOCOL,
  IV_CANDIDATES,
  USER_AGENT,
  API_TIMEOUT_MS,
};