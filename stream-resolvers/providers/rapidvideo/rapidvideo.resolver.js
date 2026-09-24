'use strict';

const { URL } = require('url');
const axios = require('axios');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');
// DESHABILITADO: capture con navegador (Puppeteer/Chrome) no se usa en el VPS
// para no saturar CPU/RAM con recursos limitados.

const RAPIDVIDEO_HOSTS = [
  'rapidvideo.link',
  'rapidvideo.stream',
  'rapidvideo.icu',
  'rapidvideo.wtf',
  'rapidvideo.vip',
  'rvf.io',
  'rapidvideo.yt',
];

function isRapidVideoUrl(url) {
  try {
    const parsed = new URL(url);
    if (!RAPIDVIDEO_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
    return /^\/(e|v|embed|d|file|download)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

const UA = DEFAULT_OPTIONS.defaultUserAgent;

class RapidVideoResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.RAPIDVIDEO || 'rapidvideo');
    this._timeout = options.httpTimeoutMs || 45000;
  }

  canResolve(url) {
    return isRapidVideoUrl(url);
  }

  async _captureWithBrowser(url) {
    // DESHABILITADO: requiere navegador; no se usa en el VPS (CPU/RAM limitados).
    throw new Error('RapidVideo deshabilitado: requiere navegador (no disponible en VPS).');
  }

  async resolve(url, options = {}) {
    // DESHABILITADO: requiere navegador; no se usa en el VPS (CPU/RAM limitados).
    throw new Error('RapidVideo deshabilitado: requiere navegador (no disponible en VPS).');
  }
}

module.exports = { RapidVideoResolver, isRapidVideoUrl };
