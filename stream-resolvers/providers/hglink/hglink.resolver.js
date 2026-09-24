'use strict';

const { URL } = require('url');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');
// DESHABILITADO: este resolver solo funciona con navegador (Puppeteer/Chrome).
// No se usa en el VPS para no saturar CPU/RAM con recursos limitados.

const HGLINK_HOSTS = ['hglink.to', 'vibuxer.com', 'vibuxer.org'];

function isHglinkUrl(url) {
  try {
    const parsed = new URL(url);
    if (!HGLINK_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
    return /^\/(e|embed|f|v|d|file)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

const UA = DEFAULT_OPTIONS.defaultUserAgent;

class HglinkResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.HGLINK || 'hglink');
    this._timeout = options.httpTimeoutMs || 45000;
  }

  canResolve(url) {
    return isHglinkUrl(url);
  }

  async resolve(url, options = {}) {
    // DESHABILITADO: requiere navegador; no se usa en el VPS (CPU/RAM limitados).
    throw new Error('HGLINK deshabilitado: requiere navegador (no disponible en VPS).');
  }
}

module.exports = { HglinkResolver, isHglinkUrl };