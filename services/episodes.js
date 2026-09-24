const axios = require("axios");
const cheerio = require("cheerio");

const { fetchWithBrowser } = require("../utils/session-provider");
const { getTMDBKey, TMDB_API_KEY } = require("../utils/config");
const { fetchTmdbSeasonEpisodes } = require("../utils/tmdb-season");
const { isGenericEpisodeName, splitSyl, cleanTMDBTitle } = require("../utils/title-utils");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
  "User-Agent": BROWSER_UA,
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

/**
 * Ajusta la fecha de emisión de anime de JST (UTC+9) a LATAM (UTC-5).
 * TMDB reporta las fechas de emisión en hora japonesa. Para Latinoamérica,
 * el anime emitido a medianoche JST del "31 de julio" realmente está
 * disponible desde las 10:30 AM del "30 de julio" en UTC-5.
 * Por tanto, restamos 1 día a la fecha de TMDB.
 */
function adjustAnimeAirDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return dateStr;
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0]; // "YYYY-MM-DD"
  } catch (_) {
    return dateStr;
  }
}


const TMDB_ENRICH_CACHE = new Map();
const TMDB_CACHE_TTL = 60 * 60 * 1000;

function buildTMDBThumb(path) {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}
const SEASON_CLEAN_RE = /\s*[-–\s]*(?:\d+(?:st|nd|rd|th)?\s*(?:season|temporada|part|parte)|(?:season|temporada|part|parte)\s*\d+|II{1,3}|IV|V|VI{1,3}|final\s*season)\s*$/i;

const SEASON_DETECT_RE = /(?:(\d+)(?:st|nd|rd|th)?\s*(?:season|temporada)|(?:season|temporada)\s*(\d+))/i;

const ROMAN_TO_SEASON = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

function detectSeason(title) {
  if (!title) return null;

  // 0. Detección de Especiales (Season 0)
  const specialKeywords = ["recap", "special", "especial", "ova", "oad"];
  if (specialKeywords.some(kw => title.toLowerCase().includes(kw))) {
    return 0;
  }

  const match = title.match(SEASON_DETECT_RE);
  if (match) return parseInt(match[1] || match[2]);
  const romanMatch = title.match(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)(?=\s*[:–—-]|\s*$)/i);
  if (romanMatch) return ROMAN_TO_SEASON[romanMatch[1].toUpperCase()] || null;
  return null;
}

async function resolveTMDBId(title, altTitles = [], year = null) {
  if (!getTMDBKey()) return null;
  const titlesToTry = [title, ...altTitles].filter(Boolean);
  for (const t of titlesToTry) {
    const clean = cleanTMDBTitle(t, SEASON_CLEAN_RE);
    if (!clean) continue;

    const queries = [
      splitSyl(clean),
      clean.split(":")[0].trim(),
      clean.split(/[-–:]/)[0].trim(),
    ].filter((q, i, self) => q && q.length > 2 && self.indexOf(q) === i);

    for (const searchQ of queries) {
      const cacheKey = `search:${year || ''}:${searchQ.toLowerCase().trim()}`;
      const cached = TMDB_ENRICH_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < TMDB_CACHE_TTL) {
        if (cached.id !== undefined) return cached.id;
        continue;
      }

      try {
        const { data } = await axios.get("https://api.themoviedb.org/3/search/tv", {
          params: { api_key: getTMDBKey(), query: searchQ, language: "es-MX" },
          timeout: 6000,
        });
        const results = data.results || [];
        if (results.length === 0) continue;

        const normalize = (str) =>
          str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, " ") : "";
        const normQ = normalize(searchQ);

        const scored = results.map(r => {
          const name = normalize(r.name);
          const origName = normalize(r.original_name);
          const resultYear = parseInt((r.first_air_date || r.release_date || '').slice(0, 4), 10) || null;
          let score = 0;
          if (name === normQ || origName === normQ) score += 1000;
          else if (name.includes(normQ) || origName.includes(normQ) || normQ.includes(name) || normQ.includes(origName)) score += 100;
          if (year && resultYear) {
            if (resultYear === year) score += 500;
            else if (Math.abs(resultYear - year) <= 2) score += 100;
            else score -= 250;
          }
          if ((r.genre_ids || []).includes(16)) score += 50;
          if (r.original_language === 'ja') score += 30;
          score += (r.popularity || 0) / 100;
          return { item: r, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const best = scored[0]?.item;
        if (best) {
          TMDB_ENRICH_CACHE.set(cacheKey, { id: best.id, ts: Date.now() });
          return best.id;
        }
      } catch {}
    }
  }
  return null;
}

async function enrichWithTMDB(result, tmdbId, season = 1, searchTitle = "") {
  if (!result || !result.episodes || result.episodes.length === 0 || !getTMDBKey()) return result;
  if (result.episodes.some(e => e.title && e.description)) return result;

  const id = tmdbId || (result.tmdbId) || null;
  if (!id) return result;

  const cacheKey = `season:${id}:${season}:${searchTitle.toLowerCase()}`;
  const cached = TMDB_ENRICH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TMDB_CACHE_TTL) {
    if (cached.episodes) {
      const enriched = result.episodes.map(ep => {
        const tmdb = cached.episodes.find(e => Number(e.episode_number) === Number(ep.number));
        if (tmdb) return { ...ep, title: tmdb.name, description: tmdb.overview, airDate: adjustAnimeAirDate(tmdb.air_date), thumbnail: buildTMDBThumb(tmdb.still_path) || ep.thumbnail, duration: tmdb.runtime ? `${tmdb.runtime} min` : (ep.duration || null), runtime: tmdb.runtime || ep.runtime || null };
        return ep;
      });
      return { ...result, episodes: enriched, tmdbId: id, season, seasonAirDate: cached.seasonAirDate || null };
    }
    return result;
  }

  try {
    // 1. Obtener detalles del show
    const showDetailRes = await axios.get(`https://api.themoviedb.org/3/tv/${id}`, {
      params: { api_key: getTMDBKey() },
      timeout: 5000,
    });
    const totalSeasonsOnTMDB = showDetailRes.data.number_of_seasons || 1;

    // 2. Verificar si la temporada solicitada no existe en TMDB (temporadas fusionadas)
    const isMerged = season > totalSeasonsOnTMDB && season !== 0;

    // 3. Definir secuencia de búsqueda (priorizando Season 1 sobre especiales Season 0)
    const seasonsToTry = [season];
    if (isMerged) {
      if (!seasonsToTry.includes(1)) seasonsToTry.push(1);
    } else if (season !== 1) {
      seasonsToTry.push(1);
    }
    if (season !== 0 && !seasonsToTry.includes(0)) {
      seasonsToTry.push(0);
    }

    const arcKeywords = [
      "shimetsu", "kaiyuu", "zenpen", "kouhen", "special", "especial", "ova", "oad", "arc", "hen",
    ];
    const activeKeywords = [
      ...arcKeywords.filter(kw => (searchTitle || "").toLowerCase().includes(kw)),
    ];

    // También activar gap detection si el título tiene keywords de arco y TMDB solo tiene 1 temporada
    const autoSplit = !isMerged && totalSeasonsOnTMDB <= 1 && activeKeywords.length > 0;
    if (autoSplit) {
      console.log(`[TMDB] Auto-split activado: título contiene keywords de arco pero TMDB solo tiene S1`);
    }

    for (const targetSeason of seasonsToTry) {
      // Si la temporada no existe en TMDB y no es un caso fusionado, saltar
      if (targetSeason > totalSeasonsOnTMDB && targetSeason !== 0) {
        if (!isMerged || targetSeason !== 1) continue;
      }

      const seasonPack = await fetchTmdbSeasonEpisodes(id, targetSeason, getTMDBKey);
      if (!seasonPack?.tmdbEpisodes?.length) continue;

      let tmdbEpisodes = seasonPack.tmdbEpisodes;
      let esEpisodes = seasonPack.localizedEpisodes || [];

      // Fecha del primer episodio del batch seleccionado (para casos isMerged/autoSplit).
      // Se declara FUERA del bloque if para que sea accesible en los returns del fallback
      // (si el if no se ejecuta, permanece null y se ignora en el ternario de fallbackAirDate)
      let batchFirstAirDate = null;

      // Gap detection: dividir Season 1 por fecha (> 60 días) cuando TMDB unifica temporadas
      if ((isMerged || autoSplit) && targetSeason === 1) {
        const sorted = [...tmdbEpisodes].sort((a, b) => new Date(a.air_date) - new Date(b.air_date));
        const groups = [];
        let currentGroup = [];
        let prevDate = null;
        for (const ep of sorted) {
          if (!ep.air_date) { currentGroup.push(ep); continue; }
          const currDate = new Date(ep.air_date);
          if (prevDate && Math.abs(currDate - prevDate) / (1000 * 60 * 60 * 24) > 60) {
            groups.push(currentGroup);
            currentGroup = [];
          }
          currentGroup.push(ep);
          prevDate = currDate;
        }
        if (currentGroup.length > 0) groups.push(currentGroup);

        if (isMerged) {
          if (season <= groups.length) {
            tmdbEpisodes = groups[season - 1];
            console.log(`[TMDB] Mapeados ${tmdbEpisodes.length} episodios para Temporada ${season} desde fusión de Season 1.`);
          } else {
            console.log(`[TMDB] Temporada ${season} no encontrada ni en fusión (solo ${groups.length} grupos detectados).`);
            continue;
          }
        } else if (autoSplit) {
          // Generar keywords adicionales desde el título de búsqueda
          const titleWords = searchTitle.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3 && !["with","that","this","from","they","what","about","which","when","after","before","jujutsu","kaisen","season","temporada","part","parte","cour","anime","series","movie","film","the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","have","been","more","some","them","their","then","very","just","also","would","could","should","than","into","over","such","only","other","than","will","each","made","like","first","second","third","fourth"].includes(w));

          // Combinar keywords predefinidas + palabras del título
          const allKeywords = [...new Set([...activeKeywords, ...titleWords])];

          let bestBatch = null;
          let bestScore = 0;
          for (let i = 0; i < groups.length; i++) {
            const batch = groups[i];
            const score = batch.reduce((sum, ep) => {
              const text = ((ep.name || "") + " " + (ep.overview || "")).toLowerCase();
              return sum + allKeywords.filter(kw => text.includes(kw)).length;
            }, 0);
            if (score > bestScore) {
              bestScore = score;
              bestBatch = i;
            }
          }
          if (bestBatch !== null && bestScore > 0) {
            tmdbEpisodes = groups[bestBatch];
            console.log(`[TMDB] Auto-split: batch ${bestBatch + 1} (score ${bestScore}) seleccionado para "${searchTitle}"`);
          } else {
            // Fallback: usar el ÚLTIMO batch (el más reciente = la continuación)
            tmdbEpisodes = groups[groups.length - 1];
            console.log(`[TMDB] Auto-split: sin match de keywords, usando último batch (batch ${groups.length}).`);
          }
        }

        // Capturar la fecha del primer episodio del batch ANTES de renumerar
        // → Esto es el "año real" de la temporada cuando TMDB la tiene fusionada en Season 1
        batchFirstAirDate = adjustAnimeAirDate(tmdbEpisodes[0]?.air_date) || null;

        // Renumerar episodios del batch a 1, 2, 3...
        const batchIds = new Set(tmdbEpisodes.map(e => e.id));
        esEpisodes = esEpisodes.filter(e => batchIds.has(e.id));
        tmdbEpisodes = tmdbEpisodes.map((ep, idx) => ({ ...ep, episode_number: idx + 1 }));
        esEpisodes = esEpisodes.map((ep, idx) => ({ ...ep, episode_number: idx + 1 }));
      }

      // Validar si esta temporada contiene el arco buscado (vía palabras clave en sinopsis)
      if (activeKeywords.length > 0 && targetSeason !== season) {
        const hasArcMatch = tmdbEpisodes.some(ep =>
          activeKeywords.some(kw =>
            (ep.name || "").toLowerCase().includes(kw) ||
            (ep.overview || "").toLowerCase().includes(kw)
          )
        );
        if (!hasArcMatch) {
          console.log(`[TMDB Robustness] Season ${targetSeason} ignorada: no coincide con keywords del arco "${searchTitle}"`);
          continue;
        }
      }

      // Si encontramos episodios, intentamos mapearlos al resultado
      const mergedEpisodes = tmdbEpisodes.map((enEp, idx) => {
        const esEp = esEpisodes.find(e => e.episode_number === enEp.episode_number) || esEpisodes[idx];
        return {
          episode_number: enEp.episode_number,
          name: esEp && !isGenericEpisodeName(esEp.name) ? esEp.name : enEp.name,
          overview: esEp && !isGenericEpisodeName(esEp.overview) ? esEp.overview : enEp.overview,
          still_path: enEp.still_path || esEp?.still_path || null,
          air_date: enEp.air_date || null,
          runtime: enEp.runtime || null
        };
      });

      // Mapeo inteligente de bloques: si el scraper tiene 1..12 pero TMDB tiene 48..60
      // Buscamos el primer episodio que coincida con las keywords para alinear el índice.
      let offset = 0;
      if (activeKeywords.length > 0) {
        const firstMatchIdx = mergedEpisodes.findIndex(ep =>
          activeKeywords.some(kw => (ep.name || "").toLowerCase().includes(kw) || (ep.overview || "").toLowerCase().includes(kw))
        );
        if (firstMatchIdx !== -1) {
          // Si el primer episodio del arco en TMDB es el N, y el nuestro es el 1...
          // Reajustamos los números de episodio para que coincidan con el scraper (1..N)
          const arcBlock = mergedEpisodes.slice(firstMatchIdx, firstMatchIdx + result.episodes.length);
          const mappedEpisodes = arcBlock.map((ep, i) => ({
            ...ep,
            episode_number: i + 1 // Forzamos 1, 2, 3... para que el Scraper lo encuentre
          }));

          TMDB_ENRICH_CACHE.set(cacheKey, { episodes: mappedEpisodes, seasonAirDate: batchFirstAirDate || null, ts: Date.now() });

          const enriched = result.episodes.map(ep => {
            const tmdb = mappedEpisodes.find(e => Number(e.episode_number) === Number(ep.number));
            if (tmdb) return { ...ep, title: tmdb.name, description: tmdb.overview, airDate: adjustAnimeAirDate(tmdb.air_date), thumbnail: buildTMDBThumb(tmdb.still_path) || ep.thumbnail, duration: tmdb.runtime ? `${tmdb.runtime} min` : (ep.duration || null), runtime: tmdb.runtime || ep.runtime || null };
            return ep;
          });
          return { ...result, episodes: enriched, tmdbId: id, season: targetSeason, seasonAirDate: batchFirstAirDate || null };
        }
      }

      // Fallback: Mapeo secuencial (1->1, 2->2...)
      // Para casos no-split, el seasonAirDate es el primer episodio de la temporada original
      const fallbackAirDate = (isMerged || autoSplit) ? (batchFirstAirDate || null) : (adjustAnimeAirDate(tmdbEpisodes[0]?.air_date) || null);
      TMDB_ENRICH_CACHE.set(cacheKey, { episodes: mergedEpisodes, seasonAirDate: fallbackAirDate, ts: Date.now() });
      const enriched = result.episodes.map(ep => {
        const tmdb = mergedEpisodes.find(e => Number(e.episode_number) === Number(ep.number));
        if (tmdb) return { ...ep, title: tmdb.name, description: tmdb.overview, airDate: adjustAnimeAirDate(tmdb.air_date), thumbnail: buildTMDBThumb(tmdb.still_path) || ep.thumbnail, duration: tmdb.runtime ? `${tmdb.runtime} min` : (ep.duration || null), runtime: tmdb.runtime || ep.runtime || null };
        return ep;
      });
      return { ...result, episodes: enriched, tmdbId: id, season: targetSeason, seasonAirDate: fallbackAirDate };
    }
  } catch (err) {
    console.warn(`[enrichWithTMDB] Error: ${err.message}`);
  }

  TMDB_ENRICH_CACHE.set(cacheKey, { episodes: null, ts: Date.now() });
  return result ? { ...result, seasonAirDate: result.seasonAirDate ?? null } : result;
}

async function getEpisodes(url, source, options = {}) {
  if (!url || !source) return { error: "Parameters 'url' and 'source' are required" };

  const slug = new URL(url).pathname.replace(/\/+$/, "").split("/").pop() || "";
  const { title, tmdbId, season, altTitle, year } = typeof options === "string" ? { title: options } : options;
  const targetSeason = season ? parseInt(season, 10) : null;

  let result;
  switch (source) {
    case "DoramasLatinox": {
      // Dooplay: la ficha de la serie lista episodios en #seasons .se-c:
      // <a href='/episodio/<slug>-<SxE>/'><li>...<div class='numerando'>S - E</div>
      try {
        const { data } = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 15000 });
        const $ = cheerio.load(data);
        const episodes = [];
        const seen = new Set();
        $("#seasons .se-c").each((_, seasonEl) => {
          const seasonNum = parseInt($(seasonEl).find(".se-q .se-t").first().text().trim(), 10) || 1;
          if (targetSeason && seasonNum !== targetSeason) return;
          $(seasonEl).find("ul.episodios a").each((__, aEl) => {
            const href = $(aEl).attr("href") || "";
            const numerando = $(aEl).find(".numerando").first().text().trim(); // "S - E"
            const m = numerando.match(/(\d+)\s*-\s*(\d+)/);
            if (!href || !m) return;
            const epNum = parseInt(m[2], 10);
            if (seen.has(epNum)) return;
            seen.add(epNum);
            episodes.push({
              number: epNum,
              season: seasonNum,
              url: href.startsWith("http") ? href : "https://doramaslatinox.com" + href,
              title: $(aEl).find(".episodiotitle").first().clone().children().remove().end().text().trim() || null,
              thumbnail: $(aEl).find(".imagen img").first().attr("src") || null,
            });
          });
        });
        if (episodes.length > 0) {
          episodes.sort((a, b) => a.number - b.number);
          result = { source, url, slug, total: episodes.length, episodes };
        } else {
          result = { source, url, slug, total: 0, episodes: [], note: "No se encontraron episodios en la ficha." };
        }
      } catch (err) {
        console.warn(`[DoramasLatinox] Episodes error: ${err.message}`);
        result = { source, url, slug, total: 0, episodes: [], note: `Error: ${err.message}` };
      }
      break;
    }
    case "Tudorama": {
      try {
        const { data } = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 15000 });
        const $ = cheerio.load(data);
        const episodes = [];
        const seen = new Set();

        // 1) AJAX WStream (lista completa; el SSR solo trae las últimas 8)
        try {
          const $eps = $(".eps").first();
          const ajaxBase = ($eps.attr("data-ajaxurl") || "https://tudorama.com/wp-admin/").replace(/\/+$/, "/");
          const nonce = $eps.attr("data-nonce");
          const postId = $eps.attr("data-tmdb-id");
          const seasonAttr = $eps.attr("data-season-number") || "1";
          const order = $eps.attr("data-order") || "DESC";
          if (nonce && postId) {
            const body = new URLSearchParams({
              action: "corvus_get_episodes",
              nonce,
              post_id: postId,
              season: seasonAttr,
              results: "50",
              offset: "0",
              order,
            });
            const { data: ajaxRes } = await axios.post(ajaxBase + "admin-ajax.php", body, {
              headers: {
                ...BROWSER_HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
                Referer: url,
                Origin: new URL(url).origin,
              },
              timeout: 15000,
            });
            const obj = typeof ajaxRes === "string" ? JSON.parse(ajaxRes) : ajaxRes;
            const results = (obj && obj.data && obj.data.results) || [];
            for (const ep of results) {
              const epNum = parseInt(ep.episode_number, 10);
              const seasonNum = parseInt(ep.season_number, 10) || 1;
              if (!epNum || seen.has(seasonNum + "x" + epNum)) continue;
              if (targetSeason && seasonNum !== targetSeason) continue;
              seen.add(seasonNum + "x" + epNum);
              episodes.push({
                number: epNum,
                season: seasonNum,
                url: ep.permalink,
                title: ep.name || ep.title || null,
                description: ep.overview || null,
                thumbnail: ep.episode_image || null,
                airDate: ep.release_date || null,
              });
            }
          }
        } catch (ajaxErr) {
          console.warn(`[Tudorama] AJAX episodes fallback: ${ajaxErr.message}`);
        }

        // 2) Fallback: HTML SSR (solo las últimas N)
        if (episodes.length === 0) {
          $("li.lep").each((_, el) => {
            const $li = $(el);
            const epNum = parseInt($li.attr("data-episode"), 10);
            const seasonNum = parseInt($li.attr("data-season"), 10) || 1;
            if (!epNum || seen.has(seasonNum + "x" + epNum)) return;
            if (targetSeason && seasonNum !== targetSeason) return;
            const href = $li.find('a[href*="/ver/"]').first().attr("href") || $li.find("a").first().attr("href") || "";
            if (!href) return;
            seen.add(seasonNum + "x" + epNum);
            episodes.push({
              number: epNum,
              season: seasonNum,
              url: href.startsWith("http") ? href : "https://tudorama.com" + href,
              title: $li.find(".lep__title").first().text().trim() || null,
              thumbnail: $li.find("img").first().attr("src") || $li.find("img").first().attr("data-src") || null,
            });
          });
        }

        episodes.sort((a, b) => a.season - b.season || a.number - b.number);
        if (episodes.length > 0) {
          result = { source, url, slug, total: episodes.length, episodes };
        } else {
          result = { source, url, slug, total: 0, episodes: [], note: "No se encontraron episodios en la ficha." };
        }
      } catch (err) {
        console.warn(`[Tudorama] Episodes error: ${err.message}`);
        result = { source, url, slug, total: 0, episodes: [], note: `Error: ${err.message}` };
      }
      break;
    }
    case "DoramasYT": {
      try {
        const pageRes = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 15000 });
        const $ = cheerio.load(pageRes.data);
        const ajaxUrl = $(".caplist").attr("data-ajax");
        const token = $("meta[name='csrf-token']").attr("content");
        if (!ajaxUrl || !token) throw new Error("No se encontró pagination AJAX o CSRF token");
        const cookie = (pageRes.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
        const ajaxHeaders = {
          ...BROWSER_HEADERS,
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/plain, */*",
          Referer: url,
        };
        const body1 = new URLSearchParams();
        body1.append("_token", token);
        const r1 = await axios.post(ajaxUrl, body1, { headers: ajaxHeaders, timeout: 15000 });
        const d1 = typeof r1.data === "string" ? JSON.parse(r1.data) : r1.data;
        const paginateUrl = d1.paginate_url;
        const perpage = parseInt(d1.perpage, 10) || 50;
        const totalNums = Array.isArray(d1.eps) ? d1.eps.length : 0;
        const pageCount = Math.max(1, Math.ceil(totalNums / perpage));
        const episodes = [];
        for (let p = 1; p <= pageCount; p++) {
          const body = new URLSearchParams();
          body.append("_token", token);
          body.append("p", String(p));
          const r = await axios.post(paginateUrl, body, { headers: ajaxHeaders, timeout: 15000 });
          const pageData = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          for (const cap of pageData.caps || []) {
            const epNum = parseInt(cap.episodio, 10);
            if (!epNum || !cap.url) continue;
            const seasonNum = 1;
            if (targetSeason && seasonNum !== targetSeason) continue;
            episodes.push({
              number: epNum,
              season: seasonNum,
              url: cap.url,
              title: null,
              thumbnail: cap.thumb || pageData.default || null,
            });
          }
        }
        episodes.sort((a, b) => a.season - b.season || a.number - b.number);
        if (episodes.length > 0) {
          result = { source, url, slug, total: episodes.length, episodes };
        } else {
          result = { source, url, slug, total: 0, episodes: [], note: "No se encontraron episodios en la ficha." };
        }
      } catch (err) {
        console.warn(`[DoramasYT] Episodes error: ${err.message}`);
        result = { source, url, slug, total: 0, episodes: [], note: `Error: ${err.message}` };
      }
      break;
    }
    case "DoramasMP4": {
      try {
        const { data } = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 15000 });
        const origin = new URL(url).origin;
        const episodes = [];
        const seen = new Set();

        // Preferimos initialEpisodes (JSON escapado dentro del RSC payload)
        const key = '\\"initialEpisodes\\":[';
        const kidx = data.indexOf(key);
        if (kidx >= 0) {
          const start = data.indexOf("[", kidx);
          let depth = 0, end = -1;
          for (let i = start; i < data.length; i++) {
            if (data[i] === "[") depth++;
            else if (data[i] === "]") { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end > start) {
            let raw = data.slice(start, end + 1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
            try {
              const eps = JSON.parse(raw);
              for (const ep of eps) {
                const epNum = parseInt(ep.episode_number, 10);
                const seasonNum = parseInt(ep.season_number, 10) || 1;
                const href = ep.href || `/capitulos/${ep.slug}`;
                if (!epNum || seen.has(seasonNum + "x" + epNum)) continue;
                if (targetSeason && seasonNum !== targetSeason) continue;
                seen.add(seasonNum + "x" + epNum);
                episodes.push({
                  number: epNum,
                  season: seasonNum,
                  url: href.startsWith("http") ? href : origin + href,
                  title: ep.title || null,
                  thumbnail: ep.stillUrl || null,
                });
              }
            } catch (_) { /* fallback a regex */ }
          }
        }

        // Fallback / complemento: enlaces literales href="/capitulos/..."
        if (episodes.length === 0) {
          const re = /href="(\/capitulos\/[^"]+)"/g;
          let m;
          while ((m = re.exec(data))) {
            const href = m[1];
            const sm = href.match(/-(\d+)x(\d+)/);
            if (!sm) continue;
            const seasonNum = parseInt(sm[1], 10);
            const epNum = parseInt(sm[2], 10);
            if (seen.has(seasonNum + "x" + epNum)) continue;
            if (targetSeason && seasonNum !== targetSeason) continue;
            seen.add(seasonNum + "x" + epNum);
            episodes.push({
              number: epNum,
              season: seasonNum,
              url: origin + href,
              title: null,
              thumbnail: null,
            });
          }
        }

        episodes.sort((a, b) => a.season - b.season || a.number - b.number);
        if (episodes.length > 0) {
          result = { source, url, slug, total: episodes.length, episodes };
        } else {
          result = { source, url, slug, total: 0, episodes: [], note: "No se encontraron episodios en la ficha." };
        }
      } catch (err) {
        console.warn(`[DoramasMP4] Episodes error: ${err.message}`);
        result = { source, url, slug, total: 0, episodes: [], note: `Error: ${err.message}` };
      }
      break;
    }
    case "Pandrama": {
      try {
        const { data } = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 15000 });
        const marker = "window.bootstrapData = ";
        const s = data.indexOf(marker);
        if (s < 0) throw new Error("No se encontró bootstrapData");
        let depth = 0, i = data.indexOf("{", s), start = i, end = -1;
        for (; i < data.length; i++) {
          if (data[i] === "{") depth++;
          else if (data[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end < 0) throw new Error("bootstrapData JSON incompleto");
        const bd = JSON.parse(data.slice(start, end + 1));
        const tp = bd.loaders && bd.loaders.titlePage;
        if (!tp) throw new Error("No se encontró titlePage loader");
        const origin = new URL(url).origin;
        const titleId = tp.title && tp.title.id;
        const titleSlug = tp.title && tp.title.slug;
        const epsData = (tp.episodes && (Array.isArray(tp.episodes) ? tp.episodes : tp.episodes.data)) || [];
        const episodes = [];
        const seen = new Set();
        for (const ep of epsData) {
          const epNum = parseInt(ep.episode_number, 10);
          const seasonNum = parseInt(ep.season_number, 10) || 1;
          if (!epNum || seen.has(seasonNum + "x" + epNum)) continue;
          if (targetSeason && seasonNum !== targetSeason) continue;
          seen.add(seasonNum + "x" + epNum);
          const epUrl = titleId && titleSlug
            ? `${origin}/titulo/${titleId}/${titleSlug}/temporada/${seasonNum}/episodio/${epNum}`
            : null;
          episodes.push({
            number: epNum,
            season: seasonNum,
            url: epUrl || url,
            title: ep.name || null,
            description: ep.description || null,
            thumbnail: ep.poster || null,
            airDate: ep.release_date ? ep.release_date.slice(0, 10) : null,
          });
        }
        episodes.sort((a, b) => a.season - b.season || a.number - b.number);
        if (episodes.length > 0) {
          result = { source, url, slug, total: episodes.length, episodes };
        } else {
          result = { source, url, slug, total: 0, episodes: [], note: "No se encontraron episodios en la ficha." };
        }
      } catch (err) {
        console.warn(`[Pandrama] Episodes error: ${err.message}`);
        result = { source, url, slug, total: 0, episodes: [], note: `Error: ${err.message}` };
      }
      break;
    }
    default:
      return { error: `Source "${source}" is not supported` };
  }

  if (result && !result.error && result.episodes && result.episodes.length > 0) {
    let resolvedTmdbId = tmdbId;
    let resolvedSeason = season;

    // Priorizamos el título completo (que incluye el nombre del arco) para la resolución de TMDB
    const searchTitle = options.fullTitle || title;

    if (!resolvedTmdbId && searchTitle) resolvedTmdbId = await resolveTMDBId(searchTitle, altTitle ? [altTitle] : [], year || null);
    if ((!resolvedSeason || resolvedSeason <= 1) && searchTitle) {
      const detected = detectSeason(searchTitle);
      if (detected !== null) resolvedSeason = detected;
    }
    if (resolvedTmdbId) result = await enrichWithTMDB(result, resolvedTmdbId, resolvedSeason || 1, searchTitle);
  }

  return result ? { ...result, seasonAirDate: result.seasonAirDate ?? null } : result;
}

function clearCache() {
  TMDB_ENRICH_CACHE.clear();
}

module.exports = { getEpisodes, clearCache };
