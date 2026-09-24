'use strict';

const YTPLAY_HOST_RE = /^ytplay\.rpmvid\.com$/i;

// Player URLs carry the video hash in the URL fragment:
// https://ytplay.rpmvid.com/#{hash}
const PLAYER_URL_RE = /^https?:\/\/ytplay\.rpmvid\.com\/?#([A-Za-z0-9_-]+)(?:\/.*)?$/i;

const PLAYER_FRAGMENT_RE = /#([A-Za-z0-9_-]+)/;

// Static AES-CBC credential shared by the YTPlay player. The player platform
// is the same one used by the UPnShare player, hence the identical protocol
// string and IV candidates. Verified against the live /api/v1/video response.
const PROTOCOL = 'kiemtienmua911ca';

// Initialization vectors are tried in order (same as the reference player).
const IV_CANDIDATES = Object.freeze(['1234567890oiuytr', '0123456789abcdef']);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const API_TIMEOUT_MS = 20000;

module.exports = {
  YTPLAY_HOST_RE,
  PLAYER_URL_RE,
  PLAYER_FRAGMENT_RE,
  PROTOCOL,
  IV_CANDIDATES,
  USER_AGENT,
  API_TIMEOUT_MS,
};
