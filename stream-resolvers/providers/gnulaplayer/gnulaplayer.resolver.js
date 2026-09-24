'use strict';

const { URL } = require('url');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES } = require('../../core/resolver.types');

// Player propio de GnulaHD (/nuevo/player.php?id=... en cualquier espejo
// oficial: ww3.gnulahd.nu, gnulahd.click, gnulahd.bid).
// Es una página con ad-gate + redirect JS: NO hay stream directo extraíble
// por HTTP estático (verificado byte-level: sin iframes, sin .mp4/.m3u8,
// mainVideoUrl stub). Se clasifica como webview-only para que el cliente lo
// distinga de hosts sí resolubles (filemoon, voe, dood...). Sin red.
const GNULA_HOSTS_RE = /(^|\.)gnulahd\.(nu|click|bid)$/i;

function isGnulaPlayerUrl(url) {
  try {
    const parsed = new URL(url);
    if (!GNULA_HOSTS_RE.test(parsed.hostname.toLowerCase())) return false;
    return parsed.pathname.includes('player.php') || parsed.pathname.includes('/nuevo/player');
  } catch {
    return false;
  }
}

class GnulaPlayerResolver extends StreamResolver {
  constructor(options = {}) {
    super((PROVIDER_IDS && PROVIDER_IDS.GNULAPLAYER) || 'gnulaplayer');
    this._options = options || {};
  }

  canResolve(url) {
    return isGnulaPlayerUrl(url);
  }

  async resolve(url) {
    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl: url,
      streamUrl: url,
      type: STREAM_TYPES.UNKNOWN,
      headers: {
        Referer: 'https://ww3.gnulahd.nu/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      metadata: { webviewOnly: true, requiresBrowser: true },
    });
  }
}

module.exports = { GnulaPlayerResolver, isGnulaPlayerUrl };
