'use strict';

// OK.ru embeds are served from these origins. Player entry points follow:
//   https://{host}/videoembed/{videoId}   preferred input format
//   https://{host}/video/{videoId}        optional alias with the same mechanism
//
// The embed page embeds an HTML-escaped JSON string inside a `data-options`
// attribute. That object carries the public movie metadata (a JSON string under
// `flashvars.metadata`) which in turn exposes the HLS master playlist and the
// progressive MP4 variants.
const OKRU_HOSTS = [
  'ok.ru',
  'www.ok.ru',
];

// Exact hostname comparison — never match domains that merely contain ok.ru.
const OKRU_HOSTNAME_RE = /^(?:www\.)?ok\.ru$/i;

// Video IDs are long numeric identifiers (e.g. 15497983822508).
const OKRU_VIDEOEMBED_PATH_RE = /^\/videoembed\/([0-9]+)\/?$/;
const OKRU_VIDEO_PATH_RE = /^\/video\/([0-9]+)\/?$/;

const OKRU_PAGE_TIMEOUT_MS = 20000;
const OKRU_MASTER_TIMEOUT_MS = 20000;

const OKRU_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Header set sent to the public videoembed page (mirrors a desktop browser).
const OKRU_PAGE_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
});

// OK.ru rejects playback unless the embed page marks the video as processed.
const OKRU_UNAVAILABLE_MARKERS = Object.freeze([
  'Во время обработки видео произошла ошибка', // "an error occurred while processing the video"
  'data-movie-id="null"', // embed stub with no movie assigned
  'vp_video_stub', // player error stub container
]);

const OKRU_PLAYABLE_QUALITY_ORDER = Object.freeze([
  'ultra',
  'full',
  'hd',
  'sd',
  'low',
  'lowest',
  'mobile',
]);

module.exports = {
  OKRU_HOSTS,
  OKRU_HOSTNAME_RE,
  OKRU_VIDEOEMBED_PATH_RE,
  OKRU_VIDEO_PATH_RE,
  OKRU_PAGE_TIMEOUT_MS,
  OKRU_MASTER_TIMEOUT_MS,
  OKRU_USER_AGENT,
  OKRU_PAGE_HEADERS,
  OKRU_UNAVAILABLE_MARKERS,
  OKRU_PLAYABLE_QUALITY_ORDER,
};