'use strict';

// Internet Archive exposes direct file URLs as:
//   https://{host}/download/{identifier}/{filename}
// where {filename} is already the media file (e.g. `03.LGKg_V2633.mp4`).
// Only the `/download/` path points at an actual file; `/details/{id}` is a
// metadata page and must never be treated as playable.
const ARCHIVE_HOSTS = Object.freeze([
  'archive.org',
  'www.archive.org',
]);

// Strict hostname match — never claim domains that merely contain archive.org.
const ARCHIVE_HOSTNAME_RE = /^(?:www\.)?archive\.org$/i;

// Internet Archive distribution nodes (e.g. ia601403.us.archive.org) may also
// serve the same files. Only the well-known strict numeric pattern is accepted;
// arbitrary unknown subdomains must NOT be claimed.
const ARCHIVE_DISTRIBUTION_HOSTNAME_RE = /^ia[0-9]{6}\.us\.archive\.org$/i;

// /download/{identifier}/{filename}
const ARCHIVE_DOWNLOAD_PATH_RE = /^\/download\/[^/]+\/([^/]+)$/;

// Formats considered reproducible by the current player/pipeline. Keep the
// list aligned with what the backend treats as a direct media file.
const ARCHIVE_MEDIA_EXTENSIONS = Object.freeze(['.mp4', '.webm', '.m4v', '.mov']);

const ARCHIVE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = {
  ARCHIVE_HOSTS,
  ARCHIVE_HOSTNAME_RE,
  ARCHIVE_DISTRIBUTION_HOSTNAME_RE,
  ARCHIVE_DOWNLOAD_PATH_RE,
  ARCHIVE_MEDIA_EXTENSIONS,
  ARCHIVE_USER_AGENT,
};