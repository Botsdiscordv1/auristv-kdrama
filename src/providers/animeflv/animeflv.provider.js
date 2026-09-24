const cheerio = require('cheerio');
const { ContentProvider } = require('../base/ContentProvider');

const BASE = 'https://animeflv.or.at';
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

function slugToTitle(slug) {
  return (slug || '')
    .replace(/(\d+)([a-z]{3,})/gi, '$1-$2')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\s+(?:19|20)\d{2}$/, '')
    .replace(/\b(?:Ii|Iii|Iv|Vi|Vii|Viii|Ix|X)\b/g, m => m.toUpperCase())
    .replace(/\b(No|Ga|Na|Wa|To|Ni|De|Mo|Ka|Ya|O|He|Ne|Yo|Ze|Sa|Tte|Da|Desu|Masu|Kara|Made|Yori|Wo|E)\b/g, m => m.toLowerCase())
    .replace(/\b(De|Las|Los|Del|La|El|En|Un|Una|Con|Por|Para|Sin|Entre|Sobre|Y|E|O|A|Al|Su)\b/g, m => m.toLowerCase());
}

const DOMAINS = [
  'https://animeflv.or.at',
  'https://animeflv.ar',
  'https://www3.animeflv.net',
];

class AnimeFLVProvider extends ContentProvider {
  constructor() {
    super('AnimeFLV', BASE, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      cacheTTL: FIVE_MIN,
      maxRequests: 60,
      failureThreshold: 3,
    });
  }

  async search(query) {
    return this._executeRequest(
      async () => {
        let cleanQuery = query.replace(/\s*\[slugs:[^\]]+\]/, '').trim();
        cleanQuery = cleanQuery.replace(/\b(\w{1,4})\s+(?=\1\b)/gi, '');
        cleanQuery = cleanQuery.replace(/\b(no|ga|na|wa|to|ni|de|mo|ka|ya|o|he)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (cleanQuery.length > 50) {
          const words = cleanQuery.split(/\s+/).filter(w => w.length > 2 || /^\d/.test(w));
          cleanQuery = words.slice(0, 5).join(' ');
        }

        const results = [];
        const qWords = normalize(cleanQuery).split(/\s+/).filter(w => w.length > 2);

        try {
          const url = `${BASE}/?s=${encodeURIComponent(cleanQuery)}`;
          const { data } = await this.client.get(url, {
            headers: { Referer: BASE + '/' },
          });
          const $ = cheerio.load(data);

          $('.search-series-card, article .bsx, article').each((_, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            if (!href || !href.includes('/anime/')) return;

            const title = $(el).find('.entry-title, .tt, h2, h3').first().text().trim();
            if (!title) return;

            const seasonText = $(el).find('.epx').text().trim();
            const typeText = $(el).find('.typez').text().trim();
            const thumbnail = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

            const tWords = normalize(title).split(/\s+/).filter(w => w.length > 2);
            const common = qWords.filter(w => tWords.includes(w)).length;
            const relevance = qWords.length > 0 ? common / Math.max(qWords.length, 1) : 0;
            if (qWords.length >= 3 && relevance < 0.3) return;
            if (qWords.length < 3 && relevance === 0) return;

            let quality = 'Sub Español';
            if (typeText) quality = typeText + ' • ' + quality;

            const isSeasonLabel = seasonText && /season|temporada|part\b|serie|s[1-9]/i.test(seasonText);
            const fullTitle = isSeasonLabel && !title.includes(seasonText) ? `${title} (${seasonText})` : title;

            if (!results.find(r => r.url === href)) {
              results.push({
                title: fullTitle,
                url: href,
                quality,
                thumbnail,
              });
            }
          });
        } catch {}

        const querySlug = query
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');

        const directSlugs = [querySlug];
        const altSlug1 = querySlug.replace(/[-](season|temporada|temp)$/i, '');
        if (altSlug1 !== querySlug && altSlug1.length > 5 && !directSlugs.includes(altSlug1)) directSlugs.push(altSlug1);
        const altSlug2 = querySlug.replace(/[-]?\d+(?:st|nd|rd|th)?[-](?:season|temporada|temp)$/i, '');
        if (altSlug2 !== querySlug && altSlug2.length > 5 && !directSlugs.includes(altSlug2)) directSlugs.push(altSlug2);

        for (const s of [...directSlugs]) {
          const segments = s.split('-');
          for (let si = 0; si < segments.length; si++) {
            const seg = segments[si];
            if (seg.length < 6) continue;
            for (let ci = 3; ci < seg.length - 2; ci++) {
              const variant = [...segments.slice(0, si), seg.slice(0, ci), seg.slice(ci)].join('-');
              if (!directSlugs.includes(variant)) directSlugs.push(variant);
            }
          }
        }

        for (const slug of directSlugs) {
          const directUrl = `${BASE}/anime/${slug}/`;
          if (results.find(r => r.url === directUrl)) continue;
          try {
            const headRes = await this.client.get(directUrl, {
              headers: { Referer: BASE + '/' },
              maxRedirects: 3,
            });
            if (headRes.status === 200 && !headRes.data.includes('error404') && !headRes.data.includes('Page not found')) {
              const $direct = cheerio.load(headRes.data);
              const pageTitle = $direct('.entry-title, h1, .tt').first().text().trim() || query;
              const thumb = $direct('.anime_pic img, .poster img, img.attachment-').first().attr('src') || '';
              const epx = $direct('.epx, .episodes-total, .num_ep').first().text().trim();
              const isSeasonLabel = epx && /season|temporada|part\b|serie|s[1-9]/i.test(epx);
              const fullPageTitle = isSeasonLabel && !pageTitle.includes(epx) ? `${pageTitle} (${epx})` : pageTitle;
              results.push({
                title: fullPageTitle,
                url: directUrl,
                quality: 'Sub Español',
                thumbnail: thumb,
              });
              break;
            }
          } catch {}
        }

        return results;
      },
      ['search', query],
      FIVE_MIN
    );
  }

  async episodes(url) {
    return this._executeRequest(
      async () => {
        const parsedUrl = url.startsWith('http') ? new URL(url) : null;
        const slug = (parsedUrl ? parsedUrl.pathname : url).replace(/\/+$/, '').split('/').pop() || '';
        if (!slug) return { error: 'Invalid URL' };

        let lastErr;
        for (const domain of DOMAINS) {
          try {
            const pageUrl =
              parsedUrl && new URL(parsedUrl).origin === new URL(domain).origin
                ? url
                : `${domain}/anime/${slug}`;
            const { data } = await this.client.get(pageUrl);
            const $ = cheerio.load(data);
            const episodes = [];

            $('script:not([src])').each((_, el) => {
              const html = $(el).html() || '';
              const match = html.match(/\[\s*\{\s*"post_id"\s*:\s*\d+,\s*"permalink"\s*:\s*"https?:\\\/\\\/[^"]+",\s*"number"\s*:\s*\d+/);
              if (match) {
                const jsonStart = match.index;
                let depth = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < html.length; i++) {
                  if (html[i] === '[') depth++;
                  else if (html[i] === ']') {
                    depth--;
                    if (depth === 0) { jsonEnd = i + 1; break; }
                  }
                }
                if (jsonEnd > jsonStart) {
                  try {
                    const rawJson = html.substring(jsonStart, jsonEnd);
                    const items = JSON.parse(rawJson);
                    if (Array.isArray(items)) {
                      items.forEach(item => {
                        if (item.number && item.permalink && !episodes.find(e => e.number === item.number)) {
                          episodes.push({ number: item.number, id: item.post_id, url: item.permalink });
                        }
                      });
                    }
                  } catch {}
                }
              }
            });

            if (episodes.length === 0) {
              $('script:not([src])').each((_, el) => {
                const html = $(el).html() || '';
                const match = html.match(/var\s+episodes\s*=\s*\[(\[[\d,]+\](?:,\s*\[[\d,]+\])*)\]/);
                if (match) {
                  try {
                    const parsed = JSON.parse(`[${match[1]}]`);
                    parsed.forEach(([num, id]) => {
                      if (num && !episodes.find(e => e.number === num)) {
                        episodes.push({ number: num, id, url: `${domain}/ver/${slug}-${num}` });
                      }
                    });
                  } catch {}
                }
              });
            }

            if (episodes.length === 0) {
              $('a[href*="episodio"], a[href*="/ver/"]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const match = href.match(/(?:episodio|ver\/[^\/]+)-(\d+)/i);
                if (match) {
                  const num = parseInt(match[1], 10);
                  if (!episodes.find(e => e.number === num)) {
                    episodes.push({ number: num, url: href.startsWith('http') ? href : new URL(href, domain).href });
                  }
                }
              });
            }

            if (episodes.length > 0) {
              episodes.sort((a, b) => a.number - b.number);
              return { source: 'AnimeFLV', url: pageUrl, slug, total: episodes.length, episodes };
            }
          } catch (err) {
            lastErr = err;
            continue;
          }
        }

        return { error: `No se pudo conectar con AnimeFLV: ${lastErr?.message || 'dominios caídos'}` };
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
        const $ = cheerio.load(data);
        const tracks = [];

        const buttonContainers = $('.button-container').toArray();
        for (const container of buttonContainers) {
          const $c = $(container);
          const label = $c.find('.tooltip-text').text().trim() || $c.find('span').text().trim();
          const button = $c.find('.iframe_code, [data-src]').first();
          const dataSrc = button.attr('data-src');
          if (dataSrc) {
            try {
              let decoded = Buffer.from(dataSrc, 'base64').toString('utf-8');
              if (decoded.startsWith('http')) {
                if (decoded.includes('player.zilla-networks.com/play/')) {
                  const zillaId = decoded.split('/play/').pop().split('?')[0].split('#')[0];
                  if (zillaId) decoded = `https://player.zilla-networks.com/m3u8/${zillaId}`;
                }

                if (decoded.includes('mp4upload.com/embed-') || decoded.includes('mp4upload.com/')) {
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
                    if (mp4Match && mp4Match[1]) decoded = mp4Match[1];
                  } catch (err) {
                    console.error('[AnimeFLV] Failed to resolve MP4Upload direct link:', err.message);
                  }
                }

                const isMp4Upload = decoded.includes('mp4upload.com');
                const isHls = decoded.includes('zilla-networks.com');
                tracks.push({
                  label: label || `Opción ${tracks.length + 1}`,
                  url: decoded,
                  isEmbed: !(isMp4Upload || isHls),
                  headers: {
                    Referer: isMp4Upload ? 'https://www.mp4upload.com/' : BASE + '/',
                    'User-Agent': UA,
                  },
                });
              }
            } catch {}
          }
        }

        if (tracks.length === 0) {
          const items = $('.iframe_code, [data-src]').toArray();
          for (let i = 0; i < items.length; i++) {
            const el = items[i];
            const dataSrc = $(el).attr('data-src');
            if (dataSrc) {
              try {
                let decoded = Buffer.from(dataSrc, 'base64').toString('utf-8');
                if (decoded.startsWith('http')) {
                  if (decoded.includes('player.zilla-networks.com/play/')) {
                    const zillaId = decoded.split('/play/').pop().split('?')[0].split('#')[0];
                    if (zillaId) decoded = `https://player.zilla-networks.com/m3u8/${zillaId}`;
                  }

                  if (decoded.includes('mp4upload.com/embed-') || decoded.includes('mp4upload.com/')) {
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
                      if (mp4Match && mp4Match[1]) decoded = mp4Match[1];
                    } catch (err) {
                      console.error('[AnimeFLV] Failed to resolve MP4Upload direct link (fallback):', err.message);
                    }
                  }

                  tracks.push({
                    label: $(el).text().trim() || `Opción ${i + 1}`,
                    url: decoded,
                    isEmbed: !(decoded.includes('mp4upload.com') || decoded.includes('zilla-networks.com')),
                    headers: {
                      Referer: decoded.includes('mp4upload.com') ? 'https://www.mp4upload.com/' : BASE + '/',
                      'User-Agent': UA,
                    },
                  });
                }
              } catch {}
            }
          }
        }

        tracks.sort((a, b) => {
          const isAHls = a.label.toUpperCase().includes('HLS') || a.url.includes('zilla-networks.com');
          const isBHls = b.label.toUpperCase().includes('HLS') || b.url.includes('zilla-networks.com');
          if (isAHls && !isBHls) return -1;
          if (!isAHls && isBHls) return 1;
          return 0;
        });

        let videoUrl = tracks.length > 0 ? tracks[0].url : null;

        if (!videoUrl) {
          $('iframe').each((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src') || '';
            if (!videoUrl && !src.includes('facebook') && !src.includes('google') && src.length > 10) {
              videoUrl = src;
            }
          });
        }

        if (!videoUrl) {
          const match = data.match(/var\s+video\s*=\s*['"]([^'"]+)['"]/);
          if (match) videoUrl = match[1];
        }

        if (!videoUrl) {
          $('video source').each((_, el) => {
            const src = $(el).attr('src');
            if (src && !videoUrl) videoUrl = src;
          });
        }

        if (videoUrl && videoUrl.includes('player.zilla-networks.com/play/')) {
          const zillaId = videoUrl.split('/play/').pop().split('?')[0].split('#')[0];
          if (zillaId) videoUrl = `https://player.zilla-networks.com/m3u8/${zillaId}`;
        }

        if (!videoUrl) return { error: 'No video URL found on AnimeFLV page' };

        return {
          url: videoUrl,
          headers: { Referer: BASE + '/', 'User-Agent': UA },
          tracks: tracks.length > 0 ? tracks : undefined,
        };
      },
      ['streams', url],
      TWO_MIN
    );
  }
}

module.exports = { AnimeFLVProvider };