'use strict';

const ZILLA_HOST = 'player.zilla-networks.com';

const ZILLA_M3U8_PATH_RE = /^\/m3u8\/[a-zA-Z0-9_-]+/;

const ZILLA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = { ZILLA_HOST, ZILLA_M3U8_PATH_RE, ZILLA_USER_AGENT };