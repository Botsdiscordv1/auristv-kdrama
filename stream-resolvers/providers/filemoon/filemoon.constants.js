'use strict';

// Los dominios filemoon.* y luluvdo.com son instancias del frontend "Byse"
// (mismo SPA y API /api/videos/{fileCode} + decryptPlayback). Se resuelven con
// el resolver de byse, no con este stub. Se dejan sin hosts para que el registry
// no los reclame y caigan en ByseResolver.
const EMBED_HOSTS = [];

const EMBED_PATH_RE = /^\/(e|d|v)\/[a-zA-Z0-9]+/;

module.exports = { EMBED_HOSTS, EMBED_PATH_RE };