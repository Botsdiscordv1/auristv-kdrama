'use strict';

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { createResolverFetcher } = require('../../core/resolver.utils');
const { ResolverParseError, ResolutionFailedError } = require('../../core/resolver.errors');

class StreamHjResolver extends StreamResolver {
  constructor(options = {}) {
    super('streamhj');
    this._http = options.http || createResolverFetcher({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
  }

  canResolve(url) {
    if (typeof url !== 'string') return false;
    return url.includes('multiplayer.streamhj.top') || url.includes('streamhj.top/player');
  }

  async resolve(url, options = {}) {
    console.log(`[StreamHjResolver] Resolving multiplayer gateway URL: ${url}`);
    const response = await this._http(url, {
      headers: {
        Referer: 'https://animejara.com/'
      },
      timeoutMs: 15000,
      responseType: 'text'
    });

    if (response.status >= 400) {
      throw new Error(`StreamHj player page returned HTTP ${response.status}`);
    }

    const regex = /playVideo\((?:&quot;|"|')([^)'"]+)(?:&quot;|"|')\)/g;
    let match;
    const urls = [];
    while ((match = regex.exec(response.body || '')) !== null) {
      urls.push(match[1].trim());
    }

    if (urls.length === 0) {
      throw new ResolverParseError('Could not extract any video server URLs from StreamHj player page');
    }

    // Prioridades de servidores
    const priorities = [
      'voe.sx',
      'bysekoze.com', // Filemoon
      'hgcloud.to', // StreamHG/Zilla
      'filelions', 'vidhide',
      'uqload',
      'streamtape',
      'mxdrop', 'mixdrop',
      'mp4upload',
      'savefiles'
    ];

    const sortedUrls = urls.sort((a, b) => {
      const getPriority = (u) => {
        const idx = priorities.findIndex(p => u.includes(p));
        return idx !== -1 ? idx : 999;
      };
      return getPriority(a) - getPriority(b);
    });

    console.log(`[StreamHjResolver] ${sortedUrls.length} servers found:`);
    sortedUrls.forEach((u, i) => console.log(`  [${i + 1}] ${u}`));

    // Cargar dinámicamente resolveStream para evitar dependencias circulares
    const { resolveStream } = require('../../index');

    let lastError = null;
    for (const targetUrl of sortedUrls) {
      try {
        console.log(`[StreamHjResolver] Trying to resolve nested url: ${targetUrl}`);
        const resolved = await resolveStream(targetUrl, options);
        if (resolved && resolved.success) {
          // Devolvemos el resultado resuelto pero conservando provider original o indicando streamhj
          return ResolverResult.ok({
            provider: resolved.provider,
            sourceUrl: url,
            streamUrl: resolved.streamUrl,
            type: resolved.type,
            headers: resolved.headers || {},
            title: resolved.title,
            expiresAt: resolved.expiresAt,
            metadata: {
              ...resolved.metadata,
              streamHjOriginalUrl: targetUrl
            }
          });
        }
      } catch (err) {
        console.warn(`[StreamHjResolver] Failed resolving nested url ${targetUrl}: ${err.message}`);
        lastError = err;
      }
    }

    throw new ResolutionFailedError(`StreamHj failed to resolve any of the nested servers. Last error: ${lastError ? lastError.message : 'none'}`);
  }
}

module.exports = { StreamHjResolver };
