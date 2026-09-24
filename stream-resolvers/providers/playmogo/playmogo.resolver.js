'use strict';

const { execFile } = require('child_process');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');
const { extractPassMd5Path, parseDoodSource } = require('../dood/dood.parser');
const { DoodResolver } = require('../dood/dood.resolver');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PASS_MD5_TOKEN_RE = /\/pass_md5\/[a-z0-9-]+\/([a-z0-9]+)/i;

function chromeHeaders(accept, dest, mode, site, extra) {
  return {
    'User-Agent': UA,
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': dest,
    'sec-fetch-mode': mode,
    'sec-fetch-site': site,
    ...(extra || {}),
  };
}

function curlGet(url, headers, timeoutMs) {
  const args = ['-s', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', UA];
  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`);
  }
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

class PlaymogoResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.PLAYMOGO || 'playmogo');
    this._timeout = options.httpTimeoutMs || DEFAULT_OPTIONS.httpTimeoutMs;
  }

  canResolve(url) {
    return /playmogo\.com\/e\//i.test(url || '');
  }

  async resolve(url) {
    const page = await curlGet(
      url,
      chromeHeaders(
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'document',
        'navigate',
        'none',
        { 'sec-fetch-user': '?1', 'upgrade-insecure-requests': '1' }
      ),
      this._timeout
    );
    const passMd5Path = extractPassMd5Path(page);
    if (!passMd5Path) {
      throw new Error('Playmogo: could not find pass_md5 path');
    }
    const md5Token = (passMd5Path.match(PASS_MD5_TOKEN_RE) || [])[1] || '';
    if (!md5Token) {
      throw new Error('Playmogo: could not extract md5 token');
    }

    const origin = new URL(url).origin;
    const md5Url = new URL(passMd5Path, origin).toString();
    const fileId = new URL(url).pathname.split('/').filter(Boolean)[1] || '';

    const md5Body = await curlGet(
      md5Url,
      chromeHeaders('*/*', 'empty', 'cors', 'same-origin', {
        Referer: `${origin}/e/${fileId}`,
      }),
      this._timeout
    );
    const parsedSource = parseDoodSource(md5Body || '', md5Url);
    if (!parsedSource || !parsedSource.mediaUrl) {
      throw new Error('Playmogo: could not extract media URL');
    }

    // Reuse DoodStream's final-URL composer (token + expiry suffix).
    const dood = new DoodResolver();
    const finalUrl = dood._composeFinalUrl(parsedSource.mediaUrl, md5Token);

    return ResolverResult.ok({
      provider: this.providerId,
      sourceUrl: url,
      streamUrl: finalUrl,
      type: STREAM_TYPES.MP4,
      headers: { Referer: `${origin}/`, 'User-Agent': UA },
    });
  }
}

module.exports = { PlaymogoResolver };
