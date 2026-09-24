const cheerio = require('cheerio');
const { ContentProvider } = require('../base/ContentProvider');

const BASE = 'https://animeav1.com';
const CDN = 'https://cdn.animeav1.com';
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

class AnimeAV1Provider extends ContentProvider {
  constructor() {
    super('AnimeAV1', BASE, {
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

  async search(query) {
    return this._executeRequest(
      async () => {
        const cleanQuery = query.replace(/\s*\[slugs:[^\]]+\]/, '').trim();
        if (!/[a-z]{2,}/i.test(cleanQuery)) return [];

        const url = `${BASE}/catalogo?search=${encodeURIComponent(cleanQuery)}`;
        const { data } = await this.client.get(url, {
          headers: { Referer: BASE },
        });
        const $ = cheerio.load(data);
        const results = [];
        const q = normalize(cleanQuery);
        const qWords = q.split(/\s+/).filter(w => w.length > 2);

        $('a[href*="/media/"]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href.includes('/media/')) return;

          const rawTitle =
            $(el).find('h3, h2').first().text().trim() ||
            $(el).find('img').attr('alt') ||
            $(el).text().trim();
          const title = rawTitle.replace(/^ver\s+/i, '').replace(/\s*\(\d{4}\)$/, '').trim();
          if (!title || title.length < 2) return;

          const fullUrl = href.startsWith('http') ? href : BASE + href;
          const slug = href.replace(/\/+$/, '').split('/').pop();

          const tTitle = normalize(title);
          const tSlug = slug.toLowerCase();
          const matchCount = qWords.filter(w => tTitle.includes(w) || tSlug.includes(w)).length;
          const wordRatio = matchCount / qWords.length;
          const req = qWords.length >= 6 ? 0.85 : qWords.length >= 4 ? 0.75 : qWords.length >= 2 ? 0.65 : 0.6;
          if (qWords.length > 0 && wordRatio < req) return;

          const thumbnail = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

          let extraTags = [];
          if (slug.includes('movie') || slug.includes('pelicula')) extraTags.push('Película');
          else if (slug.includes('ova')) extraTags.push('OVA');
          else if (slug.includes('ona')) extraTags.push('ONA');
          else if (slug.includes('special') || slug.includes('especial')) extraTags.push('Especial');
          else extraTags.push('TV');

          let quality = 'Sub Español';
          if (extraTags.length) quality = extraTags.join(' • ') + ' • ' + quality;

          results.push({
            title,
            url: fullUrl,
            quality,
            thumbnail,
            slug,
          });
        });

        return results;
      },
      ['search', query],
      FIVE_MIN
    );
  }

  async episodes(url) {
    return this._executeRequest(
      async () => {
        const slug = new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || '';
        if (!slug) return { error: 'Invalid URL' };

        const { data } = await this.client.get(url);
        const episodes = [];
        const mediaIdMatch = data.match(/media:\{id:(\d+)/);
        const mediaId = mediaIdMatch ? parseInt(mediaIdMatch[1], 10) : null;

        const jsonEpRe = /id:(\d+),number:(\d+)/g;
        let jm;
        let jsonCount = 0;
        while ((jm = jsonEpRe.exec(data)) !== null) {
          const epId = parseInt(jm[1], 10);
          const number = parseInt(jm[2], 10);
          if (!episodes.find(e => e.number === number)) {
            episodes.push({
              number,
              id: epId,
              url: `${BASE}/media/${slug}/${number}`,
              thumbnail: mediaId ? `${CDN}/screenshots/${mediaId}/${number}.jpg` : null,
            });
            jsonCount++;
          }
        }

        if (jsonCount === 0) {
          const $ = cheerio.load(data);
          $(`a[href*='/media/${slug}/']`).each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(new RegExp(`/media/${slug}/(\\d+)`, 'i'));
            if (match) {
              const num = parseInt(match[1], 10);
              if (!episodes.find(e => e.number === num)) {
                const img = $(el).find('img').first().attr('src') || '';
                episodes.push({
                  number: num,
                  url: href.startsWith('http') ? href : BASE + href,
                  thumbnail: img || (mediaId ? `${CDN}/screenshots/${mediaId}/${num}.jpg` : null),
                });
              }
            }
          });
        }

        episodes.sort((a, b) => a.number - b.number);
        return { source: 'AnimeAV1', url, slug, total: episodes.length, episodes };
      },
      ['episodes', url],
      TEN_MIN
    );
  }

  async streams(url) {
    return this._executeRequest(
      async () => {
        const { data } = await this.client.get(url, {
          headers: { Referer: BASE + '/' },
        });

        const tracks = [];
        const zillaMatches = [...data.matchAll(/https?:\/\/player\.zilla-networks\.com\/play\/([a-zA-Z0-9_-]+)/g)];

        if (zillaMatches.length > 0) {
          const uniqueIds = [...new Set(zillaMatches.map(m => m[1]))];
          const $ = cheerio.load(data);
          const sections = [];
          $('.ic-sub, .ic-dub').each((_, el) => {
            const text = $(el).text().trim().toUpperCase();
            if (text.includes('SUB')) sections.push('Subtitulado');
            else if (text.includes('DUB')) sections.push('Latino');
          });

          for (let i = 0; i < uniqueIds.length; i++) {
            const label = sections[i] || (i === 0 ? 'Subtitulado' : 'Latino');
            tracks.push({
              label,
              url: `https://player.zilla-networks.com/m3u8/${uniqueIds[i]}`,
              isEmbed: false,
              headers: { Referer: BASE + '/', 'User-Agent': UA },
            });
          }
          tracks.sort((a, b) => (a.label === 'Latino' ? -1 : 1));
        }

        if (tracks.length > 0) {
          return { url: tracks[0].url, headers: tracks[0].headers, tracks };
        }

        let videoUrl = null;
        const $ = cheerio.load(data);

        $('iframe').each((_, el) => {
          const src = $(el).attr('src') || '';
          if (src.includes('player.zilla-networks.com/play/')) {
            const id = src.split('/play/').pop().split('?')[0];
            if (id) videoUrl = `https://player.zilla-networks.com/m3u8/${id}`;
          } else if (!videoUrl && src.startsWith('http')) {
            videoUrl = src;
          }
        });

        if (!videoUrl) {
          const jsonMatch = data.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[1].trim());
              const findUrl = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.url && (obj.url.includes('.m3u8') || obj.url.includes('.mp4'))) return obj.url;
                if (obj.src && (obj.src.includes('.m3u8') || obj.src.includes('.mp4'))) return obj.src;
                for (const val of Object.values(obj)) {
                  const found = findUrl(val);
                  if (found) return found;
                }
              };
              videoUrl = findUrl(parsed);
            } catch {}
          }
        }

        if (!videoUrl) {
          videoUrl = this._extractScriptVar(data, [
            /file["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4))["']/i,
            /src["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4))["']/i,
            /videoUrl\s*=\s*["']([^"']+)["']/,
          ]);
        }

        if (!videoUrl) {
          $('video source, video').each((_, el) => {
            const src = $(el).attr('src');
            if (src && !videoUrl) videoUrl = src;
          });
        }

        if (!videoUrl) return { error: 'No video URL found on AnimeAV1 page' };
        return { url: videoUrl, headers: { Referer: BASE + '/', 'User-Agent': UA } };
      },
      ['streams', url],
      TWO_MIN
    );
  }

  _extractScriptVar(html, patterns) {
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[1];
    }
    return null;
  }
}

module.exports = { AnimeAV1Provider };