const cheerio = require('cheerio');
const { ContentProvider } = require('../base/ContentProvider');

const BASE = 'https://jkanime.net';
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
    .replace(/\b(De|Las|Los|Del|La|El|En|Un|Una|Con|Por|Para|Sin|Entre|Sobre|Y|E|O|A|Al|Su)\b/g, m => m.toLowerCase())
    .replace(/\b(\d+)\s+(nin|st|nd|rd|th)\b/gi, '$1-$2');
}

class JKAnimeProvider extends ContentProvider {
  constructor() {
    super('JKAnime', BASE, {
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
        const cleanQuery = query.replace(/\s*\[slugs:[^\]]+\]/, '').trim();
        const url = `${BASE}/buscar/${encodeURIComponent(cleanQuery)}`;
        const results = [];

        let scrapedData;
        try {
          const res = await this.client.get(url, {
            headers: { Referer: BASE + '/' },
          });
          scrapedData = res.data;
        } catch (err) {
          return [];
        }

        if (!scrapedData) return [];

        const $ = cheerio.load(scrapedData);
        $('.anime__item').each((_, el) => {
          const title = $(el).find('h5 a').text().trim();
          const href = $(el).find('h5 a').attr('href') || '';
          if (!title || !href) return;

          const slug = href.replace(/\/+$/, '').split('/').pop();
          if (!slug) return;

          const thumbnail = $(el).find('.set-bg').attr('data-setbg') || '';
          const rawType = $(el).find('.anime__item__text li.anime').text().trim();
          let type = 'TV';
          if (rawType.includes('Película') || rawType.includes('Movie')) type = 'Película';
          else if (rawType.includes('OVA')) type = 'OVA';
          else if (rawType.includes('ONA')) type = 'ONA';
          else if (rawType.includes('Especial')) type = 'Especial';

          results.push({
            title: title || slugToTitle(slug),
            url: href,
            thumbnail,
            quality: `${type} • Sub Español`,
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

        const pageRes = await this.client.get(url);
        const $ = cheerio.load(pageRes.data);

        const poster = $('.anime_pic img').attr('src') || '';
        const cdnThumbBase = poster
          ? poster.replace('/animes/image/', '/animes/video/image_thumb/').split('/').slice(0, -1).join('/') + '/'
          : '';

        const csrfToken = $('meta[name="csrf-token"]').attr('content') || '';
        const scriptText = $('script').map((_, el) => $(el).html() || '').get().join('\n');
        const idMatch = scriptText.match(/\/ajax\/episodes\/(\d+)\//);
        const animeId = idMatch ? idMatch[1] : null;
        if (!animeId) return { error: 'Could not find anime ID in page scripts' };

        const rawCookies = pageRes.headers['set-cookie'] || [];
        const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

        const baseHeaders = {
          'User-Agent': UA,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': csrfToken,
          Referer: url,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        };
        if (cookieStr) baseHeaders.Cookie = cookieStr;

        const fetchPage = async (page) => {
          const epUrl = `https://jkanime.net/ajax/episodes/${animeId}/${page}`;
          const { data } = await this._axiosPost(epUrl, `_token=${encodeURIComponent(csrfToken)}`, {
            headers: baseHeaders,
          });
          return data;
        };

        const firstPage = await fetchPage(1);
        if (!firstPage || !firstPage.data) return { error: 'Invalid response from episodes API' };

        const totalPages = firstPage.last_page || 1;
        const allEpisodes = [...firstPage.data];

        for (let p = 2; p <= totalPages; p++) {
          try {
            const pageData = await fetchPage(p);
            if (pageData && pageData.data) allEpisodes.push(...pageData.data);
          } catch (err) {
            console.warn(`[JKAnime] Failed to fetch page ${p}: ${err.message}`);
          }
        }

        const episodes = allEpisodes.map(ep => {
          const entry = { number: ep.number, id: ep.id };
          if (ep.image && cdnThumbBase) {
            entry.thumbnail = cdnThumbBase + ep.image;
          }
          return entry;
        });
        episodes.sort((a, b) => a.number - b.number);

        return { source: 'JKAnime', url, slug, total: episodes.length, episodes };
      },
      ['episodes', url],
      TEN_MIN
    );
  }

  async _axiosPost(url, body, config) {
    const axios = require('axios');
    const merged = { timeout: 10000, ...config };
    const { data } = await axios.post(url, body, merged);
    return { data };
  }

  async streams(url) {
    return this._executeRequest(
      async () => {
        const normalizedUrl = url.endsWith('/') ? url : url + '/';
        const { data } = await this.client.get(normalizedUrl, {
          headers: { Referer: BASE + '/' },
        });

        const playerUrls = [];
        const videoRe = /video\[\d+\]\s*=\s*'(?:<iframe[^>]+src=")?([^"']+)(?:"[^']*')?/gi;
        let vm;
        while ((vm = videoRe.exec(data)) !== null) {
          const src = vm[1].trim();
          if (src.length > 5 && !playerUrls.includes(src)) {
            playerUrls.push(src);
          }
        }

        if (playerUrls.length === 0) {
          const $ = cheerio.load(data);
          $('iframe').each((_, el) => {
            const src = $(el).attr('src') || '';
            if (src.length > 5) playerUrls.push(src);
          });
        }

        const tracks = [];

        const serversMatch = data.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
        if (serversMatch) {
          try {
            const serverItems = JSON.parse(serversMatch[1]);
            for (const item of serverItems) {
              if (item.remote) {
                let decoded = Buffer.from(item.remote, 'base64').toString('utf-8').trim();
                if (decoded.startsWith('http')) {
                  const label = item.server || 'Servidor';
                  if (label.toLowerCase().includes('mp4upload') || decoded.includes('mp4upload.com')) continue;

                  tracks.push({
                    label,
                    url: decoded,
                    isEmbed: true,
                    headers: { Referer: BASE + '/', 'User-Agent': UA },
                  });
                }
              }
            }
          } catch (err) {
            console.error('[JKAnime] Failed to parse servers JSON:', err.message);
          }
        }

        for (let i = 0; i < playerUrls.length; i++) {
          const playerPath = playerUrls[i];
          const fullUrl = playerPath.startsWith('http') ? playerPath : BASE + playerPath;
          try {
            const axios = require('axios');
            const playerResp = await axios.get(fullUrl, {
              headers: { ...this._headers(), Referer: url },
              timeout: 10000,
            });
            const playerHtml = typeof playerResp.data === 'string' ? playerResp.data : '';

            let directUrl = null;

            try {
              const player$ = cheerio.load(playerHtml);
              const sourceSrc = player$('source').attr('src');
              if (sourceSrc && (sourceSrc.includes('.m3u8') || sourceSrc.includes('.mp4'))) {
                directUrl = sourceSrc;
              }
            } catch {}

            if (!directUrl) {
              const dpRe = /video:\s*\{\s*url:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i;
              const dpMatch = playerHtml.match(dpRe);
              if (dpMatch) directUrl = dpMatch[1];
            }

            if (!directUrl) {
              const atobRe = /url:\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)/i;
              const atobMatch = playerHtml.match(atobRe);
              if (atobMatch) {
                const decoded = Buffer.from(atobMatch[1], 'base64').toString('utf-8');
                if (decoded) directUrl = decoded;
              }
            }

            if (!directUrl) {
              directUrl = this._extractScriptVar(playerHtml, [
                /file:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/i,
                /src:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/i,
                /url:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/i,
              ]);
            }

            if (directUrl) {
              let label = `HLS ${i + 1}`;
              if (playerPath.includes('/um?')) label = 'Desu';
              else if (playerPath.includes('/umv?')) label = 'Magi';
              tracks.push({
                label,
                url: directUrl,
                isEmbed: false,
                headers: { Referer: BASE + '/', 'User-Agent': UA },
              });
            }
          } catch (err) {
            console.error(`[JKAnime] Failed to resolve direct player ${fullUrl}:`, err.message);
          }
        }

        if (tracks.length === 0) return { error: 'No video URL found on JKAnime page' };

        tracks.sort((a, b) => {
          if (!a.isEmbed && b.isEmbed) return -1;
          if (a.isEmbed && !b.isEmbed) return 1;
          return 0;
        });

        return { url: tracks[0].url, headers: tracks[0].headers, tracks };
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

  _headers() {
    return {
      'User-Agent': UA,
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    };
  }
}

module.exports = { JKAnimeProvider };