'use strict';

const crypto = require('crypto');
const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverResult } = require('../../core/resolver.result');
const { PROVIDER_IDS, STREAM_TYPES, DEFAULT_OPTIONS } = require('../../core/resolver.types');
const { VidHideResolver } = require('../vidhide/vidhide.resolver');
const { StreamWishResolver } = require('../streamwish/streamwish.resolver');
const { VoeResolver } = require('../voe/voe.resolver');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SALT = '6d07665b9850a0db';
const vidhideResolver = new VidHideResolver();
const streamwishResolver = new StreamWishResolver();
const voeResolver = new VoeResolver();

function hexToBytes(hex) {
  const bytes = Buffer.alloc(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return bytes.toString('hex');
}

async function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

async function solvePoW(challenge, difficulty, salt) {
  const target = '0'.repeat(difficulty);
  const challengeBuf = Buffer.from(challenge, 'utf8');
  let nonce = 0;
  const maxAttempts = 5000000;
  
  while (nonce < maxAttempts) {
    const nonceBuf = Buffer.from(nonce.toString(), 'utf8');
    const input = Buffer.concat([challengeBuf, nonceBuf]);
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    
    if (hash.startsWith('0'.repeat(difficulty))) {
      return nonce.toString();
    }
    nonce++;
    if (nonce % 50000 === 0) await Promise.resolve();
  }
  throw new Error('PoW solver failed: max attempts reached');
}

async function deriveAesKey(challenge, nonce, salt) {
  const input = Buffer.from(challenge + nonce + salt, 'utf8');
  return crypto.createHash('sha256').update(input).digest(); // 32 bytes
}

function decryptLink(encryptedBase64, keyBytes) {
  const cipherBuf = Buffer.from(encryptedBase64, 'base64');
  const iv = cipherBuf.slice(0, 16);
  const ciphertext = cipherBuf.slice(16);
  const key = keyBytes.slice(0, 32);
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(true);
  const part1 = decipher.update(ciphertext);
  const part2 = decipher.final();
  return Buffer.concat([part1, part2]).toString('utf8');
}

// Los enlaces desencriptados de PelisPedia suelen ser embeds anidados
// (p.ej. morencius.com) que el resolver vidhide resuelve a MP4 de forma HTTP
// (sin navegador, apto para el VPS de 1GB). Encadenamos vidhide para entregar
// siempre un stream reproducible al cliente. No usamos el registry generico
// para evitar caer en resolvers que lanzan navegador headless (hglink/rapidvideo).
async function resolveNestedStream(decryptedUrl) {
  // Try multiple resolvers for the decrypted embed URL
  const resolvers = [
    { resolver: vidhideResolver, name: 'vidhide' },
    { resolver: streamwishResolver, name: 'streamwish' },
    { resolver: voeResolver, name: 'voe' },
  ];
  
  for (const { resolver, name } of resolvers) {
    if (resolver.canResolve(decryptedUrl)) {
      try {
        const r = await resolver.resolve(decryptedUrl);
        if (r && r.success && typeof r.streamUrl === 'string' && r.streamUrl.startsWith('http')) {
          return { url: r.streamUrl, headers: r.headers || {}, provider: name };
        }
      } catch (_) {}
    }
  }
  return { url: decryptedUrl, headers: {}, provider: null };
}

class Embed69Resolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.EMBED69 || 'embed69');
    this._timeout = options.httpTimeoutMs || DEFAULT_OPTIONS.httpTimeoutMs;
  }

  canResolve(url) {
    return /pelispedia\.(mov|com|net)\/vidurl\//i.test(url || '');
  }

  async resolve(url) {
    const fetch = (await import('node-fetch')).default;
    const pageResp = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://pelispedia.mov/',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      timeout: this._timeout,
    });
    const html = await pageResp.text();
    
    // Extract PoW parameters and dataLink
    const challengeMatch = html.match(/const\s+POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/);
    const difficultyMatch = html.match(/const\s+POW_DIFFICULTY\s*=\s*(\d+)/);
    const saltMatch = html.match(/const\s+POW_SALT\s*=\s*['"]([^'"]+)['"]/);
    const dataLinkMatch = html.match(/let\s+dataLink\s*=\s*(\[[\s\S]*?\]);/);
    
    if (!challengeMatch || !difficultyMatch || !saltMatch || !dataLinkMatch) {
      throw new Error('EMBED69: could not extract PoW params or dataLink');
    }
    
    const challenge = challengeMatch[1];
    const difficulty = parseInt(difficultyMatch[1], 10);
    const salt = saltMatch[1];
    let dataLink;
    try {
      dataLink = JSON.parse(dataLinkMatch[1]);
    } catch (e) {
      throw new Error('EMBED69: failed to parse dataLink');
    }
    
    // Solve PoW
    const nonce = await solvePoW(challengeMatch[1], parseInt(difficultyMatch[1], 10), saltMatch[1]);
    
    // Derive AES key
    const aesKey = await deriveAesKey(challengeMatch[1], nonce, saltMatch[1]);
    
    // Decrypt all links
    const tracks = [];
    for (const file of dataLink) {
      const langLabel = file.video_language === 'LAT' ? 'Latino' : (file.video_language === 'SUB' ? 'Subtitulado' : file.video_language);
      
      for (const embed of file.sortedEmbeds || []) {
        if (!embed.link) continue;
        try {
          const decryptedUrl = decryptLink(embed.link, await deriveAesKey(challengeMatch[1], nonce, saltMatch[1]));
          const { url: finalUrl, headers: finalHeaders, provider: resolvedProvider } = await resolveNestedStream(decryptedUrl);
          tracks.push({
            provider: resolvedProvider || embed.servername,
            label: file.video_language === 'LAT' ? 'Latino' : 'Subtitulado',
            url: finalUrl,
            headers: { Referer: 'https://pelispedia.mov/', 'User-Agent': UA, ...finalHeaders },
          });
        } catch (e) {}
      }
      for (const embed of file.downloadEmbeds || []) {
        if (!embed.link) continue;
        try {
          const decryptedUrl = decryptLink(embed.link, await deriveAesKey(challengeMatch[1], nonce, saltMatch[1]));
          const { url: finalUrl, headers: finalHeaders, provider: resolvedProvider } = await resolveNestedStream(decryptedUrl);
          tracks.push({
            provider: resolvedProvider || embed.servername,
            label: (file.video_language === 'LAT' ? 'Latino' : 'Subtitulado') + ' (Descarga)',
            url: finalUrl,
            headers: { Referer: 'https://pelispedia.mov/', 'User-Agent': UA, ...finalHeaders },
          });
        } catch (e) {}
      }
    }
    
    if (tracks.length === 0) {
      throw new Error('EMBED69: no links could be decrypted');
    }

    const first = tracks[0];
    // Use the actual server name from the first track as provider (e.g. "streamtape", "voe")
    // instead of "embed69" which is just the resolver name.
    const realProvider = first.provider || this.providerId;
    return ResolverResult.ok({
      provider: realProvider,
      sourceUrl: url,
      streamUrl: first.url,
      type: 'mp4',
      headers: first.headers,
      metadata: { tracks, language: first.label },
    });
  }
}

module.exports = { Embed69Resolver };