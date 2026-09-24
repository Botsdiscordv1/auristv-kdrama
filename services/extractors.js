const axios = require("axios");
const cheerio = require("cheerio");
// DESHABILITADO: fetchWithBrowser (Puppeteer) no se usa en el VPS (CPU/RAM limitados).
const { EmbedResolverService } = require("../src/services/EmbedResolverService");
const { detectDoramasYTLang } = require("../utils/helpers");

// Resolver embeds (voe, filemoon, dood, vidhide, streamtape...) a stream
// directo. Mismo servicio que usa el servidor de movies-series.
const embedResolver = new EmbedResolverService();

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

function extractFromScriptVar(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractFromJSON(html, keyPatterns) {
  for (const key of keyPatterns) {
    const re = new RegExp(`["']${key}["']\\s*:\\s*["']([^"']+)["']`, 'i');
    const match = html.match(re);
    if (match) return match[1];
    const re2 = new RegExp(`["']${key}["']\\s*:\\s*["']([^"']+)["']`, 'i');
    const m2 = html.match(re2);
    if (m2) return m2[1];
  }
  return null;
}

// Hosts conocidos de iframes decorativos/embebidos que nunca son el video.
const IFRAME_BLACKLIST = [
  "facebook.com", "google.com", "youtube.com", "youtu.be",
  "disqus.com", "twitter.com", "telegram.me", "t.me",
  "adservice", "doubleclick", "googlesyndication",
];

function isVideoIframe(src) {
  if (!src || src.length <= 10) return false;
  if (src.startsWith("data:") || src === "about:blank") return false;
  const lower = src.toLowerCase();
  return !IFRAME_BLACKLIST.some(h => lower.includes(h));
}

// Recolecta TODOS los candidatos de video de una ficha: iframes, <video>,
// data-attrs y variables JS. Devuelve tracks ordenados (primeros los que
// vienen de iframes de hosting conocido) + url del primer candidato.
function collectVideoCandidates($, data, baseUrl) {
  const candidates = [];
  const seen = new Set();
  const push = (url, label) => {
    if (!url) return;
    let abs = url.startsWith("http") ? url : (url.startsWith("//") ? "https:" + url : (url.startsWith("/") ? new URL(url, baseUrl).href : null));
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    candidates.push({ label, url: abs });
  };

  // 1) iframes
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-lazy-src") || $(el).attr("data-src") || "";
    if (isVideoIframe(src)) push(src, "iframe");
  });

  // 2) <video>/<source>
  $("video source, video").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src) push(src, "video");
  });

  // 3) data-player / data-video
  $("[data-player], [data-video]").each((_, el) => {
    const val = $(el).attr("data-player") || $(el).attr("data-video") || "";
    if (val && val.length > 10 && !val.startsWith("{")) push(val, "data");
  });

  // 4) variables JS (file:, src:, hls:, mp4:)
  const jsUrl = extractFromScriptVar(data, [
    /file["']?\s*:\s*["']([^"']+)["']/i,
    /\bsrc["']?\s*:\s*["'](https?:[^"']+)["']/i,
    /(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i,
    /(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/i,
  ]);
  if (jsUrl) push(jsUrl, "script");

  return candidates;
}

function tracksFromCandidates(candidates, referer) {
  return candidates.map((c, i) => ({
    label: `${c.label.toUpperCase()} ${i + 1}`,
    quality: "AUTO",
    url: c.url,
    isEmbed: !/\.m3u8|\.mp4/i.test(c.url),
    headers: { Referer: referer, "User-Agent": BROWSER_HEADERS["User-Agent"] },
  }));
}

const extractors = {

  // ─── Tudorama ─────────────────────────────────────────────
  // Los servidores NO están en el HTML: se cargan vía AJAX
  // (action=corvus_get_servers) con lang por servidor (es=Latino, en=Sub).
  async Tudorama(url) {
    const BASE = "https://tudorama.com";
    const { data } = await axios.get(url, {
      headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const postId = $(".ep__dropdown").attr("data-id") || "";
    const nonce = $(".ep__dropdown").attr("data-nonce") || "";

    const mapLang = (code, name) => {
      const c = String(code || "").toLowerCase().trim();
      const n = String(name || "").toLowerCase();
      if (c === "es" || /esp[:\-]|latino|espanol|español/.test(n)) return "Latino";
      if (c === "en" || /^sub[:\-]|subtitul|sub esp/.test(n)) return "Sub Español";
      return null;
    };

    const tracks = [];
    const seen = new Set();
    const pushTrack = (u, name, lang, referer) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      tracks.push({
        label: `${name || "Tudorama"}${lang ? " " + lang : ""}`.toUpperCase().trim(),
        quality: lang || "AUTO",
        url: u,
        isEmbed: !/\.m3u8|\.mp4/i.test(u),
        headers: { Referer: referer, "User-Agent": BROWSER_HEADERS["User-Agent"] },
        ...(lang ? { language: lang } : {}),
      });
    };

    // 1) Servidores con idioma por servidor (AJAX corvus_get_servers)
    if (postId && nonce) {
      try {
        const body = new URLSearchParams({ action: "corvus_get_servers", nonce, post_id: postId });
        const res = await axios.post(`${BASE}/wp-admin/admin-ajax.php`, body, {
          headers: {
            ...BROWSER_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            Referer: url,
          },
          timeout: 15000,
          validateStatus: () => true,
        });
        let list = res.data;
        if (typeof list === "string") {
          try { list = JSON.parse(list); } catch (_) { list = []; }
        }
        if (Array.isArray(list)) {
          for (const s of list) {
            if (!s || !s.url || !/^https?:/i.test(s.url)) continue;
            const lang = mapLang(s.lang, s.name) || mapLang(s.lang, s.server);
            pushTrack(s.url, s.name || s.server || "Server", lang, url);
          }
        }
      } catch (_) { /* AJAX caído: fallback a candidatos inline */ }
    }

    // 2) Fallback: candidatos inline en la página (sin idioma por servidor)
    if (tracks.length === 0) {
      const pageText = $("title").first().text() + " " + data;
      let pageLang = null;
      if (/esp\s*lat|español\s*latino|\bEspLat\b/i.test(pageText)) pageLang = "Latino";
      else if (/sub\s*esp|subtitulado|\bSubEsp\b/i.test(pageText)) pageLang = "Sub Español";
      const candidates = collectVideoCandidates($, data, url);
      candidates.forEach((c, i) => pushTrack(c.url, c.label.toUpperCase(), pageLang, BASE + "/"));
      if (tracks.length === 0) throw new Error("No video URL found on Tudorama page");
    }

    return { url: tracks[0].url, headers: tracks[0].headers, tracks };
  },

  // ─── DoramasYT ────────────────────────────────────────────
  // Flujo especial: la ficha NO trae iframes; trae botones con payload cifrado
  // (data-player) que se descifra server-side pidiendo
  // /reproductor?video=<payload>. Esa página devuelve el embed real
  // (filemoon, voe, dood...). Resolvemos TODOS los servidores y los
  // devolvemos como tracks para que EmbedResolverService los convierta a stream.
  async DoramasYT(url) {
    const BASE = "https://www.doramasyt.com";
    const { data } = await axios.get(url, {
      headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
      timeout: 15000,
    });

    const dataKey = (data.match(/data-key="([^"]+)"/) || [])[1];
    const buttons = [...data.matchAll(/data-player="([^"]+)"[^>]*data-usa-api="([^"]*)"/g)]
      .map(m => ({ payload: m[1], usaApi: m[2] }))
      .filter(b => b.payload);

    // Idioma de la variante (Sub / Latino) — slug de la ficha o link serie en la página
    const pageLang = detectDoramasYTLang(url, "", data) || detectDoramasYTLang(url, "") || "Sub Español";

    const tracks = [];
    const seen = new Set();

    const pushTrack = (u, name) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      tracks.push({
        label: `${name || "DoramasYT"} ${pageLang}`.toUpperCase().trim(),
        quality: pageLang,
        url: u,
        isEmbed: !/\.m3u8|\.mp4/i.test(u),
        headers: { Referer: BASE + "/", "User-Agent": BROWSER_HEADERS["User-Agent"] },
        language: pageLang,
      });
    };

    if (dataKey && buttons.length > 0) {
      // Pedir el reproductor de cada servidor (concurrente, límite 4)
      const results = [];
      let idx = 0;
      const workers = Array.from({ length: Math.min(4, buttons.length) }, async () => {
        while (idx < buttons.length) {
          const i = idx++;
          const b = buttons[i];
          try {
            const playerUrl = b.usaApi === "1" ? dataKey + b.payload : b.payload;
            if (!/^https?:/i.test(playerUrl)) continue;
            const res = await axios.get(playerUrl, {
              headers: { ...BROWSER_HEADERS, Referer: url },
              timeout: 15000,
            });
            const html = typeof res.data === "string" ? res.data : "";
            const embed = [...html.matchAll(/(?:data-lazy-src|data-src|src)="([^"]+)"/g)]
              .map(m => m[1])
              .find(u => /embed|\/e\/|\/f\/|download/i.test(u));
            if (embed) results[i] = embed;
          } catch (_) { /* servidor caído: se salta */ }
        }
      });
      await Promise.all(workers);
      results.filter(Boolean).forEach((u, i) => pushTrack(u, `Server ${i + 1}`));
    }

    // Fallback clásico: iframes directos en la ficha
    if (tracks.length === 0) {
      const $ = cheerio.load(data);
      const candidates = collectVideoCandidates($, data, url);
      candidates.forEach((c, i) => pushTrack(c.url, `Iframe ${i + 1}`));
    }

    if (tracks.length === 0) throw new Error("No video URL found on DoramasYT page");

    return { url: tracks[0].url, headers: tracks[0].headers, tracks };
  },

  // ─── DoramasMP4 ───────────────────────────────────────────
  async DoramasMP4(url) {
    const GQL = "https://userapi.cloudfleir.xyz/graphql";
    const GQL_HEADERS = {
      "User-Agent": BROWSER_HEADERS["User-Agent"],
      "Content-Type": "application/json",
      "Origin": "https://doramasmp4.io",
      "Referer": "https://doramasmp4.io/",
    };

    const slug = (new URL(url).pathname.replace(/\/+$/, "").split("/").pop() || "").replace(/\.html?$/i, "");
    if (!slug) throw new Error("No slug in DoramasMP4 URL");

    // 1) _id del episodio
    const qDetail = {
      operationName: "EpisodeDetailSlug",
      variables: { slug, excludedLabelSlugs: [] },
      query: `query EpisodeDetailSlug($slug: String!, $excludedLabelSlugs: [String!]) { detailEpisode(filter: { slug: $slug }, excludedLabelSlugs: $excludedLabelSlugs) { _id name episode_number season_number serie_name langs { name code_flix } } }`,
    };
    const r1 = await axios.post(GQL, qDetail, { headers: GQL_HEADERS, timeout: 20000 });
    const ep = r1.data && r1.data.data && r1.data.data.detailEpisode;
    if (!ep || !ep._id) throw new Error("DoramasMP4: episode not found for slug " + slug);

    // 2) links por servidor/idioma
    const qLinks = {
      operationName: "EpisodeLinksOnline",
      variables: { episode_id: ep._id },
      query: `query EpisodeLinksOnline($episode_id: ID!) { getEpisodeLinks(id: $episode_id, app: "android") { links_online { server lang link is_recommended } } }`,
    };
    const r2 = await axios.post(GQL, qLinks, { headers: GQL_HEADERS, timeout: 20000 });
    const links = (r2.data && r2.data.data && r2.data.data.getEpisodeLinks && r2.data.data.getEpisodeLinks.links_online) || [];
    if (links.length === 0) throw new Error("DoramasMP4: no links for " + slug);

    const langNames = {};
    (ep.langs || []).forEach(l => { if (l && l.code_flix) langNames[String(l.code_flix)] = l.name; });
    const serverNames = {
      "7286": "Dood", "958695": "Filemoon", "4721": "Prime", "1233": "Prime2",
      "1230": "Prime3", "576857": "Callistan", "1113": "PrimeFlix", "38585": "Flaswish",
    };
    // code_flix de idiomas originales (sin doblaje) → Sub Español
    // Solo Latino/Castellano/Subtitulado se quedan con su nombre propio.
    const mapLangName = (raw) => {
      const n = String(raw || "").trim();
      if (!n) return "AUTO";
      if (/latino|^lat$/i.test(n)) return "Latino";
      if (/castellano/i.test(n)) return "Castellano";
      if (/subtitulado|sub\s*esp/i.test(n)) return "Sub Español";
      // Coreano, Japones, etc. = audio original con subtítulos en español
      if (/coreano|japon|chin|tailand|mandar|portug|ingles|vietnam|filipin|indones/i.test(n)) return "Sub Español";
      return n;
    };

    // 3) resolver cada JWT al embed real vía Server Action de embedshortener
    const decodeCache = new Map();
    const decodeToken = async (jwtLink) => {
      if (decodeCache.has(jwtLink)) return decodeCache.get(jwtLink);
      let out = null;
      try {
        const embedPage = await axios.get(jwtLink, {
          headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], Referer: "https://doramasmp4.io/" },
          timeout: 15000,
        });
        const html = typeof embedPage.data === "string" ? embedPage.data : "";
        const chunkRef = html.match(/([a-z0-9_~.-]+\.js)\\\\*"\],\\\\*"Player/i);
        if (!chunkRef) return null;
        const js = await axios.get("https://embedshortener.co/_next/static/chunks/" + chunkRef[1], {
          headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] }, timeout: 15000,
        }).then(r => (typeof r.data === "string" ? r.data : ""));
        // El ID del Server Action es el único hex largo del chunk
        const actionId = (js.match(/[a-f0-9]{42}/) || [])[0];
        if (!actionId) return null;
        const res = await axios.post(jwtLink, JSON.stringify([jwtLink.split("/e/")[1]]), {
          headers: {
            "User-Agent": BROWSER_HEADERS["User-Agent"],
            "Content-Type": "text/plain;charset=UTF-8",
            "Next-Action": actionId,
            "Referer": jwtLink,
            "Origin": "https://embedshortener.co",
          }, timeout: 20000, validateStatus: () => true,
        });
        const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        const m = body.match(/iframeUrl":"((?:[^"\\]|\\.)*)"/);
        if (m) out = m[1].replace(/\\\\u002F/g, "/").replace(/\\\\\//g, "/");
      } catch (_) { /* embed caído */ }
      decodeCache.set(jwtLink, out);
      return out;
    };

    const results = [];
    let idx = 0;
    const workers = Array.from({ length: Math.min(4, links.length) }, async () => {
      while (idx < links.length) {
        const i = idx++;
        const l = links[i];
        if (!l || !l.link) continue;
        const embed = await decodeToken(l.link);
        if (embed) {
          const sName = serverNames[String(l.server)] || ("S" + l.server);
          const rawLang = langNames[String(l.lang)] || "";
          const quality = mapLangName(rawLang);
          results[i] = { embed, sName, quality, rawLang };
        }
      }
    });
    await Promise.all(workers);

    const tracks = [];
    const seen = new Set();
    results.filter(Boolean).forEach((r) => {
      if (seen.has(r.embed)) return;
      seen.add(r.embed);
      const langLabel = r.rawLang || (r.quality !== "AUTO" ? r.quality : "");
      tracks.push({
        label: (r.sName + " " + (langLabel || r.quality)).toUpperCase().trim(),
        quality: r.quality || "AUTO",
        url: r.embed,
        isEmbed: !/\.m3u8|\.mp4/i.test(r.embed),
        headers: { Referer: "https://primeload.co/", "User-Agent": BROWSER_HEADERS["User-Agent"] },
        ...(r.quality && r.quality !== "AUTO" ? { language: r.quality } : {}),
      });
    });

    if (tracks.length === 0) throw new Error("No video URL found on DoramasMP4 page");
    return { url: tracks[0].url, headers: tracks[0].headers, tracks, meta: { title: ep.serie_name || ep.name } };
  },

  // ─── DoramasLatinox ────────────────────────────────────
  // WordPress + Dooplay. La ficha del episodio (/episodio/<slug>-<SxE>/)
  // NO trae iframes: trae <li id='player-option-N' data-post data-nume>
  // que se resuelven vía POST admin-ajax action=doo_player_ajax.
  // Eso devuelve { embed_url } con el hosting real (dood, vidplay...)
  // que EmbedResolverService convierte a stream directo.
  async DoramasLatinox(url) {
    const BASE = "https://doramaslatinox.com";
    const { data } = await axios.get(url, {
      headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const options = [];
    $("#playeroptionsul li.dooplay_player_option").each((_, el) => {
      const post = $(el).attr("data-post");
      const nume = $(el).attr("data-nume");
      const type = $(el).attr("data-type") || "tv";
      const name = $(el).find("span.title").first().text().trim();
      // idioma según la bandera del servidor (mx=LAT, ar=SUB)
      const flag = $(el).find("span.flag img").first().attr("src") || "";
      const lang = /mx|latino/i.test(flag + name) ? "LATINO" : "SUBTITULADO";
      if (post && nume) options.push({ post, nume, type, name, lang });
    });

    // Fallback: iframes directos (algunos episodios los traen inline)
    const tracks = [];
    const seen = new Set();
    const pushTrack = (u, name, lang) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      tracks.push({
        label: `${name} ${lang}`.toUpperCase().trim(),
        quality: "AUTO",
        url: u,
        isEmbed: !/\.m3u8|\.mp4/i.test(u),
        headers: { Referer: BASE + "/", "User-Agent": BROWSER_HEADERS["User-Agent"] },
      });
    };

    if (options.length > 0) {
      const resolveOption = async (opt) => {
        try {
          const res = await axios.post(
            `${BASE}/wp-admin/admin-ajax.php`,
            `action=doo_player_ajax&post=${opt.post}&nume=${opt.nume}&type=${opt.type}`,
            {
              headers: {
                ...BROWSER_HEADERS,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Referer: url,
                "X-Requested-With": "XMLHttpRequest",
              },
              timeout: 15000,
            }
          );
          const embed = res.data && res.data.embed_url;
          if (embed && /^https?:/i.test(embed)) return embed;
        } catch (_) { /* opción caída */ }
        return null;
      };

      const results = await Promise.all(options.map(resolveOption));
      results.forEach((embed, i) => {
        if (embed) pushTrack(embed, options[i].name, options[i].lang);
      });
    }

    // Fallback: iframes inline en la página
    if (tracks.length === 0) {
      const candidates = collectVideoCandidates($, data, url);
      candidates.forEach((c, i) => pushTrack(c.url, `Iframe ${i + 1}`, ""));
    }

    if (tracks.length === 0) throw new Error("No video URL found on DoramasLatinox page");
    return { url: tracks[0].url, headers: tracks[0].headers, tracks };
  },

  // ─── Pandrama ─────────────────────────────────────────────
  async Pandrama(url) {
    const BASE = "https://www.pandrama.tv";
    const { data } = await axios.get(url, {
      headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const candidates = collectVideoCandidates($, data, url);
    if (candidates.length === 0) throw new Error("No video URL found on Pandrama page");

    const tracks = tracksFromCandidates(candidates, BASE + "/");
    return { url: tracks[0].url, headers: tracks[0].headers, tracks };
  },
};

async function extract(url, sourceName) {
  const sourceKey = sourceName.replace(/[^a-zA-Z0-9]/g, "");

  if (extractors[sourceName]) {
    const result = await extractors[sourceName](url);
    // Resolver embeds a stream directo (mismo pipeline que movies-series):
    // resuelve/prioriza tracks y descarta los muertos.
    return await embedResolver.enhance(result);
  }

  if (sourceName.startsWith("PelisPlus") && !sourceName.startsWith("PelisPlus21") && extractors.PelisPlus) {
    const domain = sourceName === "PelisPlusAutos" ? "https://pelisplus.autos" : "https://pelisplus21.com";
    const result = await extractors.PelisPlus(url, domain);
    return await embedResolver.enhance(result);
  }

  throw new Error(`No extractor available for source: ${sourceName}`);
}

module.exports = { extract, extractors };
