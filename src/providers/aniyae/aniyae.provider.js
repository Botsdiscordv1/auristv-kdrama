const cheerio = require('cheerio');
const { ContentProvider } = require('../base/ContentProvider');

const BASE = 'https://open.aniyae.net';
const IMG_CDN = 'https://i0.aniyae.net/api.haniyae.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FIVE_MIN = 300000;
const TEN_MIN = 600000;
const TWO_MIN = 120000;

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/**
 * Resolves a SvelteKit __data.json node into a plain JS value.
 *
 * SvelteKit deduplicates data by storing values in a flat array and using
 * numeric indices as pointers. An object schema maps keys to indices,
 * and an array schema is just a list of indices.
 *
 * @param {Array} values  The flat array from the SvelteKit data node.
 * @param {*} index       The index to resolve (number) or a raw value.
 * @param {number} depth  Recursion guard.
 * @returns {*}           The resolved value.
 */
function resolveSK(values, index, depth = 0) {
  if (depth > 12) return index;
  if (typeof index !== 'number') return index;
  const val = values[index];
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' || typeof val === 'boolean') return val;
  if (typeof val === 'number') return val;
  if (Array.isArray(val)) {
    return val.map(i => resolveSK(values, i, depth + 1));
  }
  if (typeof val === 'object') {
    const obj = {};
    for (const [k, v] of Object.entries(val)) {
      obj[k] = resolveSK(values, v, depth + 1);
    }
    return obj;
  }
  return val;
}

/**
 * Parses a SvelteKit __data.json response and returns the resolved data
 * object from the last data node.
 */
function parseSvelteKitData(json) {
  if (!json || !json.nodes) return null;
  // Find the last node that has actual page data (skip layout nodes)
  for (let i = json.nodes.length - 1; i >= 0; i--) {
    const node = json.nodes[i];
    if (!node || node.type !== 'data' || !node.data) continue;
    const values = node.data;
    if (!Array.isArray(values) || values.length < 2) continue;
    const schema = values[0];
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) continue;
    return resolveSK(values, 0, 0);
  }
  return null;
}

class AniyaeProvider extends ContentProvider {
  constructor() {
    super('Aniyae', BASE, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      cacheTTL: FIVE_MIN,
      maxRequests: 120,
      failureThreshold: 3,
    });
  }

  // ─── SEARCH ─────────────────────────────────────────────────
  async search(query) {
    return this._executeRequest(
      async () => {
        let cleanQuery = query.replace(/\s*\[slugs:[^\]]+\]/, '').trim();
        // Aniyae uses "Temporada X" internally – strip English season suffixes
        // that cause zero results (e.g. "3rd Season", "Season 2", "Part 3", "II")
        cleanQuery = cleanQuery
          .replace(/\s+\d+(?:st|nd|rd|th)\s+Season$/i, '')
          .replace(/\s+Season\s+\d+$/i, '')
          .replace(/\s+Part\s+\d+$/i, '')
          .replace(/\s+(?:II|III|IV|V|VI|VII|VIII|IX|X)$/i, '')
          .trim();
        if (!/[a-z]{2,}/i.test(cleanQuery)) return [];

        const url = `${BASE}/api/content/search`;
        const { data } = await this.client.post(url, { q: cleanQuery }, {
          headers: {
            'Content-Type': 'application/json',
            Referer: `${BASE}/buscar?q=${encodeURIComponent(cleanQuery)}`,
          },
        });

        if (!data || !Array.isArray(data.data)) return [];

        const results = [];
        for (const item of data.data) {
          if (!item || !item.code || !item.title) continue;

          const title = item.title;
          const slug = item.slug || '';
          const code = item.code;

          const posterUrl = item.posterUrl
            ? (item.posterUrl.startsWith('http') ? item.posterUrl : `${IMG_CDN}${item.posterUrl}`)
            : '';

          // Determine quality from attributes
          let quality = 'Sub Español';
          const attrs = Array.isArray(item.attributes) ? item.attributes : [];
          const hasLatino = attrs.some(a => typeof a === 'string' && /latino/i.test(a));
          const hasCastellano = attrs.some(a => typeof a === 'string' && /castellano/i.test(a));
          const hasSub = attrs.some(a => typeof a === 'string' && /sub/i.test(a));

          if (hasLatino && hasSub) quality = 'Latino • Sub';
          else if (hasLatino) quality = 'Latino';
          else if (hasCastellano) quality = 'Castellano';

          const fullUrl = item.permalink
            ? (item.permalink.startsWith('http') ? item.permalink : `${BASE}${item.permalink}`)
            : `${BASE}/details/${code}/${slug}`;

          results.push({
            title,
            url: fullUrl,
            quality,
            thumbnail: posterUrl,
            slug,
          });
        }

        return results;
      },
      ['search', query],
      FIVE_MIN
    );
  }

  // ─── EPISODES ───────────────────────────────────────────────
  async episodes(url) {
    return this._executeRequest(
      async () => {
        // Extract code and slug from URL
        // URL format: /details/{code}/{slug}
        const urlPath = url.startsWith('http') ? new URL(url).pathname : url;
        const detailsMatch = urlPath.match(/\/details\/(ANI[A-Z0-9]+)\/([^/?#]+)/);
        if (!detailsMatch) return { error: 'Invalid Aniyae details URL' };

        const code = detailsMatch[1];
        const slug = detailsMatch[2];

        const dataUrl = `${BASE}/details/${code}/${slug}/__data.json`;
        const { data } = await this.client.get(dataUrl, {
          headers: {
            Referer: `${BASE}/details/${code}/${slug}`,
            Accept: 'application/json',
          },
        });

        const json = typeof data === 'string' ? JSON.parse(data) : data;
        const resolved = parseSvelteKitData(json);
        if (!resolved) return { error: 'Failed to parse Aniyae data' };

        const episodes = [];

        // Extract episodes from episodesData
        const epData = resolved.episodesData;
        if (epData && epData.data && Array.isArray(epData.data)) {
          for (const ep of epData.data) {
            if (!ep || !ep.number) continue;
            const epSlug = ep.slug || `${slug}-episodio-${ep.number}`;
            const thumbnailUrl = ep.thumbnailUrl
              ? (ep.thumbnailUrl.startsWith('http') ? ep.thumbnailUrl : `${IMG_CDN}${ep.thumbnailUrl}`)
              : null;

            episodes.push({
              number: ep.number,
              url: `${BASE}/v/${code}/${epSlug}`,
              thumbnail: thumbnailUrl,
              title: ep.title || null,
            });
          }
        }

        // Fallback: try to parse episodes from allEpisodes if episodesData is missing
        if (episodes.length === 0 && Array.isArray(resolved.allEpisodes)) {
          for (const ep of resolved.allEpisodes) {
            if (!ep || !ep.number) continue;
            const epSlug = ep.slug || `${slug}-episodio-${ep.number}`;
            const thumbnailUrl = ep.thumbnailUrl
              ? (ep.thumbnailUrl.startsWith('http') ? ep.thumbnailUrl : `${IMG_CDN}${ep.thumbnailUrl}`)
              : null;

            episodes.push({
              number: ep.number,
              url: `${BASE}/v/${code}/${epSlug}`,
              thumbnail: thumbnailUrl,
              title: ep.title || null,
            });
          }
        }

        episodes.sort((a, b) => a.number - b.number);
        return { source: 'Aniyae', url, slug, total: episodes.length, episodes };
      },
      ['episodes', url],
      TEN_MIN
    );
  }

  // ─── STREAMS ────────────────────────────────────────────────
  async streams(url) {
    return this._executeRequest(
      async () => {
        // URL format: /v/{code}/{slug}
        const urlPath = url.startsWith('http') ? new URL(url).pathname : url;
        const playerMatch = urlPath.match(/\/v\/(ANI[A-Z0-9]+)\/([^/?#]+)/);
        if (!playerMatch) return { error: 'Invalid Aniyae player URL' };

        const code = playerMatch[1];
        const epSlug = playerMatch[2];

        const dataUrl = `${BASE}/v/${code}/${epSlug}/__data.json`;
        const { data } = await this.client.get(dataUrl, {
          headers: {
            Referer: `${BASE}/v/${code}/${epSlug}`,
            Accept: 'application/json',
          },
        });

        const json = typeof data === 'string' ? JSON.parse(data) : data;
        const resolved = parseSvelteKitData(json);
        if (!resolved) return { error: 'Failed to parse Aniyae player data' };

        const tracks = [];

        // Extract servers from episode data
        const episode = resolved.episode;
        const servers = episode && episode.servers ? episode.servers : (resolved.servers || []);

        if (Array.isArray(servers)) {
          for (const srv of servers) {
            if (!srv || !srv.url) continue;

            // Decode base64 URL
            let decoded;
            try {
              decoded = Buffer.from(srv.url, 'base64').toString('utf-8');
            } catch {
              decoded = srv.url;
            }

            if (!decoded || !decoded.startsWith('http')) continue;

            const serverName = srv.server || 'unknown';
            const type = srv.type || 'sub';
            const label = type === 'dub' ? 'Latino' : type === 'sub' ? 'Subtitulado' : type;

            // Convert zilla-networks /play/ to /m3u8/ for direct HLS
            if (decoded.includes('player.zilla-networks.com/play/')) {
              const zillaId = decoded.split('/play/').pop().split('?')[0].split('#')[0];
              if (zillaId) {
                tracks.push({
                  label: `${label} - Zilla`,
                  url: `https://player.zilla-networks.com/m3u8/${zillaId}`,
                  isEmbed: false,
                  headers: { Referer: BASE + '/', 'User-Agent': UA },
                });
                continue;
              }
            }

            // Resolve mp4upload direct links
            if (decoded.includes('mp4upload.com')) {
              try {
                const axios = require('axios');
                const embedUrl = decoded.includes('embed-')
                  ? decoded
                  : decoded.replace('mp4upload.com/', 'mp4upload.com/embed-') + '.html';
                const mp4Res = await axios.get(embedUrl, {
                  headers: { 'User-Agent': UA, Referer: BASE + '/' },
                  timeout: 8000,
                });
                const mp4Match = mp4Res.data.match(/src:\s*["'](https?:\/\/[^"']+\.mp4)["']/i);
                if (mp4Match && mp4Match[1]) {
                  tracks.push({
                    label: `${label} - Mp4Upload`,
                    url: mp4Match[1],
                    isEmbed: false,
                    headers: { Referer: 'https://www.mp4upload.com/', 'User-Agent': UA },
                  });
                  continue;
                }
              } catch (err) {
                console.error('[Aniyae] Failed to resolve MP4Upload direct link:', err.message);
              }
              // Fallback: add as embed
              tracks.push({
                label: `${label} - Mp4Upload`,
                url: decoded,
                isEmbed: true,
                headers: { Referer: BASE + '/', 'User-Agent': UA },
              });
              continue;
            }

            // PixelDrain — embed-friendly
            if (decoded.includes('pixeldrain.com')) {
              tracks.push({
                label: `${label} - PixelDrain`,
                url: decoded,
                isEmbed: false,
                headers: { Referer: BASE + '/', 'User-Agent': UA },
              });
              continue;
            }

            // Abyss / AnimeAV1
            if (decoded.includes('animeav1.') || decoded.includes('uns.bio')) {
              tracks.push({
                label: `${label} - Abyss`,
                url: decoded,
                isEmbed: true,
                headers: { Referer: BASE + '/', 'User-Agent': UA },
              });
              continue;
            }

            // Generic fallback
            tracks.push({
              label: `${label} - ${serverName}`,
              url: decoded,
              isEmbed: true,
              headers: { Referer: BASE + '/', 'User-Agent': UA },
            });
          }
        }

        // Sort: HLS (zilla) first, then direct (pixeldrain, mp4upload), then embeds
        tracks.sort((a, b) => {
          const aScore = a.url.includes('zilla-networks.com') ? 0
            : !a.isEmbed ? 1
            : 2;
          const bScore = b.url.includes('zilla-networks.com') ? 0
            : !b.isEmbed ? 1
            : 2;
          return aScore - bScore;
        });

        if (tracks.length === 0) {
          return { error: 'No video URL found on Aniyae page' };
        }

        return {
          url: tracks[0].url,
          headers: tracks[0].headers,
          tracks,
        };
      },
      ['streams', url],
      TWO_MIN
    );
  }
}

module.exports = { AniyaeProvider };
