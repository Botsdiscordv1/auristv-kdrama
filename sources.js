// ============================================================
//  sources.js - Fuentes de busqueda (KDRAMAS)
//
//  Fuentes:
//    1. Tudorama   tudorama.com   (activa)
//    2. DoramasYT  doramasyt.com  (activa)
//    3. DoramasMP4 doramasmp4.io  (activa)
//    4. Pandrama   pandrama.tv    (activa)
// ============================================================

// Headers que imitan un navegador real (evita bloqueos 403)
const cheerio = require('cheerio');
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};
// ─── Filtro anti-navegación ───────────────────────────────
const NAV_BLACKLIST = [
  "peliculas", "películas", "estrenos", "series", "anime",
  "genero", "género", "inicio", "home", "accion", "acción",
  "comedia", "terror", "drama", "ver más", "más", "populares",
  "crimen", "romance", "sorprendeme", "sorpréndeme",
  "pelicula", "película", "película de tv", "estrenos de peliculas",
  "estrenos de películas", "estrenos de pelicula", "estrenos de película",
  "nuevas peliculas", "nuevas películas",
];

const NAV_PATTERNS = [
  /^pel[ií]culas?$/i,
  /^estrenos(\s+de\s+pel[ií]culas?)?$/i,
  /^nuevas?\s+pel[ií]culas?$/i,
];

// ─── Deduplicar resultados por URL normalizada ────────────
function dedupe(results) {
  const seen = new Set();
  return results.filter(r => {
    // Normalizar URL: quitar subdominios (www, www3), trailing slash y parámetros de tracking
    const key = r.url.replace(/https?:\/\/(www\d?\.)?/, "").replace(/\/+$/, "").split("?")[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// ──────────────────────────────────────────────────────────

function isNavLink(title) {
  const t = title.toLowerCase().trim();
  if (t.length < 4) return true;
  if (NAV_BLACKLIST.includes(t)) return true;
  if (NAV_PATTERNS.some(rx => rx.test(t))) return true;
  return false;
}
// ───────────────────────────────────────────────────────

module.exports = [
  // ══════════════════════════════════════════════════════════
  //  KDRAMAS - DORAMAS — FUENTE 1 — TuDorama  (tudorama.com)
  // ══════════════════════════════════════════════════════════
  {
    name: "Tudorama",
    description: "Doramas online — tudorama.com",
    enabled: true,
    categoria: "kdrama",

    async search(query, axios, cheerio) {
      const BASE = "https://tudorama.com";

      const searchOne = async (q) => {
        const url = `${BASE}/?s=${encodeURIComponent(q)}`;

        const { data } = await axios.get(url, {
          headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
          timeout: 12000,
        });

        const $ = cheerio.load(data);
        const results = [];
        const seen = new Set();

        const addResult = (title, href, thumbnail) => {
          if (!title || !href) return;
          if (isNavLink(title)) return;
          const lower = title.toLowerCase();
          if (lower.includes("capitulo") || lower.includes("episodio")) return;
          const fullUrl = href.startsWith("http") ? href : BASE + href;
          if (/\/(category|tag|page|genero|genre|wp-content|feed)\//i.test(fullUrl)) return;
          if (seen.has(fullUrl)) return;
          seen.add(fullUrl);
          results.push({ title, url: fullUrl, quality: "Sub Español", thumbnail });
        };

        // ── Estrategia 1: tema WStream (clases reales del HTML) ──
        // <article class="ipst">
        //   <figure class="ipst__image"><a href="..."><img ...></a></figure>
        //   <div class="ipst__body">
        //     <h3 class="ipst__title"><a href="...">Título</a></h3>
        //   </div>
        // </article>
        $("article.ipst").each((_, el) => {
          const titleEl = $(el).find("h3.ipst__title a, .ipst__title a").first();
          const title = titleEl.text().trim();
          const href =
            titleEl.attr("href") ||
            $(el).find(".ipst__image a").first().attr("href") ||
            $(el).find("a").first().attr("href") || "";
          const img = $(el).find("img").first();
          const thumbnail =
            img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src") || "";
          addResult(title, href, thumbnail);
        });

        // ── Estrategia 2: contenedor .items con artículos genéricos ─
        if (results.length === 0) {
          $(".items article, .items .item").each((_, el) => {
            const titleEl = $(el).find("h2 a, h3 a, h4 a").first();
            const title = titleEl.text().trim() || $(el).find("img").first().attr("alt") || "";
            const href = titleEl.attr("href") || $(el).find("a").first().attr("href") || "";
            const img = $(el).find("img").first();
            const thumbnail = img.attr("src") || img.attr("data-src") || "";
            addResult(title, href, thumbnail);
          });
        }

        // ── Estrategia 3: fallback — cualquier article WordPress ──
        if (results.length === 0) {
          $("article").each((_, el) => {
            const titleEl = $(el).find("h2 a, h3 a, h4 a, .entry-title a").first();
            const title = titleEl.text().trim() || $(el).find("h2, h3, h4").first().text().trim();
            const href = titleEl.attr("href") || $(el).find("a").first().attr("href") || "";
            const img = $(el).find("img").first();
            const thumbnail = img.attr("src") || img.attr("data-src") || "";
            addResult(title, href, thumbnail);
          });
        }

        // ── Estrategia 4: fallback ultra-amplio por enlaces internos ─
        if (results.length === 0) {
          $("a[href*='tudorama.com/serie/'], a[href*='tudorama.com/pelicula/']").each((_, el) => {
            const href = $(el).attr("href") || "";
            const img = $(el).find("img").first();
            const title = $(el).find("h2, h3, h4").first().text().trim() ||
              img.attr("alt") || $(el).text().trim();
            const thumbnail = img.attr("src") || img.attr("data-src") || "";
            if (title.length < 3) return;
            addResult(title, href, thumbnail);
          });
        }

        return dedupe(results);
      }; // fin searchOne

      return searchOne(query);
    },
  },

  // ══════════════════════════════════════════════════════════
  //  KDRAMAS - DORAMAS — FUENTE 2 — DoramasYT  (doramasyt.com)
  // ══════════════════════════════════════════════════════════
  {
    name: "DoramasYT",
    description: "Doramas online — doramasyt.com",
    enabled: true,
    categoria: "kdrama",

    async search(query, axios, cheerio) {
      const BASE = "https://www.doramasyt.com";

      const searchOne = async (q) => {
        const url = `${BASE}/buscar?q=${encodeURIComponent(q)}`;

        const { data } = await axios.get(url, {
          headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
          timeout: 12000,
        });

        const $ = cheerio.load(data);
        const results = [];

        const normalize = (str) =>
          str
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s]/g, "")
            .trim();

        const qNorm = normalize(q);

        // Selectores amplios para distintos temas del sitio
        const CARD_SEL = [
          ".result-item",
          ".MovieItem",
          ".TPost",
          "article",
          ".item",
          ".post",
          ".doramas-item",
          ".serie-item",
        ].join(", ");

        $(CARD_SEL).each((_, el) => {
          const title =
            $(el).find("h2, h3, h4, .Title, .title, .name").first().text().trim();
          const href =
            $(el).find("a[href]").first().attr("href") ||
            $(el).closest("a[href]").attr("href") ||
            "";

          if (!title || !href) return;
          if (isNavLink(title)) return;

          const lower = title.toLowerCase();
          if (lower.includes("capitulo") || lower.includes("episodio")) return;

          // Sin filtro de palabras: el buscador del sitio ya filtra por relevancia

          const img = $(el).find("img").first();
          const thumbnail =
            img.attr("src") ||
            img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            "";

          results.push({
            title,
            url: href.startsWith("http") ? href : BASE + href,
            quality: "Sub Español",
            thumbnail,
          });
        });

        // 🔁 Fallback por links directos al catálogo
        if (results.length === 0) {
          $("a[href*='/ver/'], a[href*='/dorama/'], a[href*='/serie/']").each((_, el) => {
            const href = $(el).attr("href") || "";
            const title =
              $(el).find("h2, h3, h4").first().text().trim() ||
              $(el).find("img").first().attr("alt") ||
              $(el).text().trim();

            if (!title || title.length < 3) return;
            if (isNavLink(title)) return;

            const t = normalize(title);
            // Sin filtro de palabras en fallback

            const img = $(el).find("img").first();
            results.push({
              title,
              url: href.startsWith("http") ? href : BASE + href,
              quality: "Sub Español",
              thumbnail: img.attr("src") || img.attr("data-src") || "",
            });
          });
        }

        return dedupe(results);
      }; // fin searchOne

      return searchOne(query);
    },
  },

  // ══════════════════════════════════════════════════════════
  //  KDRAMAS - DORAMAS — FUENTE 3 — DoramasMP4  (doramasmp4.io)
  //  Sitio Next.js — usa la API interna de búsqueda /_next/data/
  //  Estrategia:
  //    1. Buscar en /search/ → extrae resultados del __NEXT_DATA__
  //    2. Scraping HTML de /search/ como respaldo
  //    3. Slug directo en /doramas/ y /peliculas/ (fallback)
  //    4. Prueba de URLs predecibles: slug-anime, slug-the-movie-part-1/2
  //    NOTA: Los items del buscador son SOLO doramas. Las películas
  //    viven bajo /peliculas/ y el buscador no siempre las incluye,
  //    por eso se prueban URLs predecibles derivadas del slug base.
  // ══════════════════════════════════════════════════════════
  {
    name: "DoramasMP4",
    description: "Doramas online — doramasmp4.io",
    enabled: true,
    categoria: "kdrama",

    async search(query, axios, cheerio) {
      const BASE = "https://doramasmp4.io";

      const toSlug = (str) =>
        str
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, "")
          .trim()
          .replace(/\s+/g, "-");


      // Limpia el texto SEO que DoramasMP4 inyecta en titulos HTML
      // "Ver True Beauty dorama online sub espanol en MP4 => DoramasMP4"
      //  => "True Beauty"
      const cleanTitle = (raw) => {
        if (!raw) return "";
        return raw
          .replace(/^Ver\s+/i, "")
          .replace(/\s+dorama\s+online.*$/i, "")
          .replace(/\s+pel[ií]cula\s+online.*$/i, "")
          .replace(/\s+online\s+sub\s+espa[\u00f1n]ol.*$/i, "")
          .replace(/\s*[\u2013\u25ba\u25b6|>-]\s*DoramasMP4.*/i, "")
          .replace(/\s*\(DoramasMP4\).*/i, "")
          .trim();
      };
      // ── Estrategia 1: __NEXT_DATA__ embebido en el HTML ──────────
      const trySearchPage = async (q) => {
        try {
          const url = `${BASE}/search/${encodeURIComponent(q)}`;
          const { data, status } = await axios.get(url, {
            headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
            timeout: 10000,
            validateStatus: (s) => s < 500,
          });
          if (status !== 200) return [];

          const match = data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
          if (!match) return [];

          const nextData = JSON.parse(match[1]);
          const pageProps = nextData?.props?.pageProps || {};

          // Recolectar TODOS los arrays válidos (puede haber doramas + peliculas por separado)
          let items = [];
          const seenSlugs = new Set();
          for (const key of Object.keys(pageProps)) {
            const val = pageProps[key];
            if (Array.isArray(val) && val.length > 0 && (val[0]?.title || val[0]?.name || val[0]?.slug)) {
              for (const item of val) {
                const slug = item.slug || item.id;
                if (slug && seenSlugs.has(String(slug))) continue;
                if (slug) seenSlugs.add(String(slug));
                items.push(item);
              }
            }
          }
          // Fallback: buscar por nombre de clave conocida en el JSON serializado
          if (!items.length) {
            const str = JSON.stringify(pageProps);
            const allMatches = [...str.matchAll(/"(results|doramas|peliculas|data|titles|animes)":\s*(\[.*?\])/gs)];
            for (const m of allMatches) {
              try {
                const arr = JSON.parse(m[2]);
                for (const item of arr) {
                  const slug = item.slug || item.id;
                  if (slug && seenSlugs.has(String(slug))) continue;
                  if (slug) seenSlugs.add(String(slug));
                  items.push(item);
                }
              } catch (_) { }
            }
          }

          if (!items.length) return [];

          return items.map((item) => {
            // Preferir título en español si el sitio lo incluye en el JSON
            const pickStr = (...candidates) => {
              for (const c of candidates) {
                if (c && typeof c === "string" && c.trim() && !/^undefined$/i.test(c.trim())) return c.trim();
              }
              return "";
            };
            const rawTitle = pickStr(
              item?.name_es, item?.spanish_title, item?.titulo_espanol, item?.titulo_español,
              item?.nombre_espanol, item?.nombre_español, item?.subtitle,
              item?.alt_title, item?.title_es, item?.titulo,
              item?.spanishTitle, item?.altTitle, item?.tituloEspanol,
              item.title, item.name
            );
            const title = cleanTitle(rawTitle);
            // El slug SIEMPRE debe venir del campo slug del JSON o del título EN inglés,
            // nunca del título en español (generaría URLs inexistentes como /doramas/los-chicos-son-mejores...)
            const rawSlug = pickStr(item.slug);
            const englishTitle = pickStr(item.title, item.name); // título original EN, no el español
            const slug = rawSlug || toSlug(englishTitle);
            // Usar tipo del item para determinar la sección correcta
            const section = (item.type || item.tipo || "").toLowerCase().includes("pelicula") ||
              (item.type || item.tipo || "").toLowerCase().includes("movie")
              ? "peliculas" : "doramas";
            const url = slug ? `${BASE}/${section}/${slug}` : "";
            const thumbnail = item.image || item.poster || item.thumbnail || item.img || item.cover || "";
            return { title, url, quality: "Sub Español", thumbnail };
          }).filter(r =>
            r.title && r.title.length > 1 && !/^undefined$/i.test(r.title) &&
            r.url && r.url.length > 10 && !/undefined/i.test(r.url)
          );
        } catch (_) { return []; }
      };

      // ── Estrategia 2: scraping HTML + JSON embebido alternativo ────
      const tryHtmlScrape = async (q) => {
        try {
          const url = `${BASE}/search/${encodeURIComponent(q)}`;
          const { data, status } = await axios.get(url, {
            headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
            timeout: 10000,
            validateStatus: (s) => s < 500,
          });
          if (status !== 200) return [];

          const found = [];
          const seen = new Set();

          // A) Bloques JSON embebidos en <script>
          const jsonBlocks = [...data.matchAll(/<script[^>]*>\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*<\/script>/g)];
          for (const [, block] of jsonBlocks) {
            try {
              const parsed = JSON.parse(block);
              const findArrays = (obj, depth = 0) => {
                if (depth > 5) return;
                if (Array.isArray(obj) && obj.length > 0) {
                  const first = obj[0];
                  if (first?.slug || first?.title || first?.name) {
                    for (const item of obj) {
                      const pickStr = (...candidates) => {
                        for (const c of candidates) {
                          if (c && typeof c === "string" && c.trim() && !/^undefined$/i.test(c.trim())) return c.trim();
                        }
                        return "";
                      };
                      const rawTitle = pickStr(
                        item?.name_es, item?.spanish_title, item?.titulo_espanol, item?.titulo_español,
                        item?.nombre_espanol, item?.nombre_español, item?.subtitle,
                        item?.alt_title, item?.title_es, item?.titulo,
                        item?.spanishTitle, item?.altTitle, item?.tituloEspanol,
                        item.title, item.name
                      );
                      const title = cleanTitle(rawTitle);
                      const rawSlug = pickStr(item.slug);
                      const englishTitle = pickStr(item.title, item.name);
                      const slug = rawSlug || toSlug(englishTitle);
                      if (!title || title.length < 2 || /^undefined$/i.test(title)) continue;
                      if (!slug) continue;
                      if (seen.has(slug)) continue;
                      seen.add(slug);
                      // Detectar si es película por tipo
                      const section = (item.type || item.tipo || "").toLowerCase().includes("pelicula") ||
                        (item.type || item.tipo || "").toLowerCase().includes("movie")
                        ? "peliculas" : "doramas";
                      const itemUrl = `${BASE}/${section}/${slug}`;
                      if (/undefined/i.test(itemUrl)) continue;
                      const thumbnail = item.image || item.poster || item.thumbnail || item.img || item.cover || "";
                      found.push({ title, url: itemUrl, quality: "Sub Español", thumbnail });
                    }
                  }
                } else if (obj && typeof obj === "object") {
                  for (const val of Object.values(obj)) findArrays(val, depth + 1);
                }
              };
              findArrays(parsed);
            } catch (_) { }
          }

          // B) HTML scraping — links a /doramas/ Y /peliculas/
          const $ = cheerio.load(data);

          $("a[href*='/doramas/'], a[href*='/peliculas/']").each((_, el) => {
            const href = $(el).attr("href") || "";
            if (!href || !/\/(doramas|peliculas)\/[a-z0-9]/.test(href)) return;
            if (seen.has(href)) return;
            seen.add(href);

            const img = $(el).find("img").first();
            const title =
              $(el).find("h1, h2, h3, h4").first().text().trim() ||
              $(el).find("[class*='title'], [class*='name']").first().text().trim() ||
              img.attr("alt") || "";

            const clean = cleanTitle(title.replace(/\s*(DORAMA|PELICULA|PELÍCULA|ANIME|SERIE)\s*/gi, "").trim());
            if (!clean || clean.length < 2) return;
            if (/undefined/i.test(clean) || /undefined/i.test(href)) return;
            if (isNavLink(clean)) return;

            const fullUrl = href.startsWith("http") ? href : BASE + href;
            found.push({
              title: clean,
              url: fullUrl,
              quality: "Sub Español",
              thumbnail: img.attr("src") || img.attr("data-src") || "",
            });
          });

          return found;
        } catch (_) { return []; }
      };

      // ── Estrategia 3: slug directo en /doramas/ (fallback) ───────
      const tryDirectSlug = async (q) => {
        const slug = toSlug(q);
        if (!slug) return [];
        const url = `${BASE}/doramas/${slug}`;
        try {
          const { data, status } = await axios.get(url, {
            headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
            timeout: 8000,
            validateStatus: (s) => s < 500,
          });
          if (status !== 200) return [];

          const $ = cheerio.load(data);
          const ogTitle = $("meta[property='og:title']").attr("content") || "";
          const h1Title = $("h1").first().text().trim();
          const title = (ogTitle || h1Title).replace(/\s*[-–|]\s*DoramasMP4.*/i, "").trim();

          if (!title || title.length < 2) return [];
          if (/not found|404|página no encontrada|error/i.test(title)) return [];
          if (/undefined/i.test(title)) return [];

          const thumbnail =
            $("meta[property='og:image']").attr("content") ||
            $("img.poster, .poster img").first().attr("src") || "";

          return [{ title, url, quality: "Sub Español", thumbnail }];
        } catch (_) { return []; }
      };

      // ── Estrategia 4: URLs predecibles derivadas del slug base ───
      // El buscador de DoramasMP4 omite variantes como:
      //   /doramas/true-beauty-anime
      //   /peliculas/true-beauty-the-movie-part-1
      //   /peliculas/true-beauty-the-movie-part-2
      // Hacemos GET a cada candidato y leemos el título real de la página.

      // Lee el título limpio de una página de DoramasMP4 (sin texto SEO)
      // Extrae el título español limpio de una página de DoramasMP4.
      // Orden: campos ES del __NEXT_DATA__ > texto visible en DOM > og:title limpio
      const fetchRealTitle = async (url) => {
        try {
          const { data, status } = await axios.get(url, {
            headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
            timeout: 8000,
            validateStatus: (s) => s < 500,
          });
          if (status !== 200) return null;

          // 1) __NEXT_DATA__: buscar título español en el objeto del dorama/pelicula
          const nextMatch = data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
          if (nextMatch) {
            try {
              const nd = JSON.parse(nextMatch[1]);
              const pp = nd?.props?.pageProps || {};
              // El objeto del contenido puede estar bajo distintas claves
              const obj = pp?.dorama || pp?.pelicula || pp?.data || pp || {};
              // Primero intentar campos que suelen contener el título en español
              const esTitle =
                obj?.name_es ||
                obj?.spanish_title || obj?.titulo_espanol || obj?.titulo_español ||
                obj?.nombre_espanol || obj?.nombre_español || obj?.subtitle ||
                obj?.alt_title || obj?.alternative_title || obj?.title_es ||
                obj?.titulo || obj?.spanishTitle ||
                obj?.altTitle || obj?.tituloEspanol || "";
              if (esTitle && esTitle.length > 1 && !/undefined/i.test(esTitle))
                return esTitle.trim();
              // Si no hay campo ES, al menos devolver el title/name del objeto
              const enTitle = obj?.title || obj?.name || "";
              if (enTitle && enTitle.length > 1 && !/undefined/i.test(enTitle))
                return enTitle.trim();
            } catch (_) { }
          }

          // 2) Texto visible: subtítulo español que DoramasMP4 muestra debajo del título EN
          const $ = cheerio.load(data);
          const esSelectors = [
            ".title-spanish", ".spanish-title", ".titulo-espanol", ".titulo-español",
            ".subtitle", ".alt-title", "[class*='spanish']", "[class*='titulo']",
            "h2.subtitle", "p.subtitle", "span.subtitle",
          ];
          for (const sel of esSelectors) {
            const t = $(sel).first().text().trim();
            if (t && t.length > 1 && !/undefined|not found|404/i.test(t) && !isNavLink(t))
              return t;
          }

          // 3) Último recurso: og:title limpiado con cleanTitle
          const og = $("meta[property='og:title']").attr("content") || "";
          const clean = cleanTitle(og);
          if (clean && clean.length > 1) return clean;

          return null;
        } catch (_) { return null; }
      };

      const tryPredictableUrls = async (baseSlug) => {
        if (!baseSlug) return [];

        // Prefijos/sufijos de versiones y remakes de otros países
        const countrySuffixes = ["thailand", "thai", "japan", "japanese", "china", "chinese", "taiwan", "korean"];
        const countryPrefixes = ["f4-thailand", "f4-japan", "f4-china"];

        const candidateUrls = [
          // Variantes originales
          `${BASE}/doramas/${baseSlug}-anime/`,
          `${BASE}/peliculas/${baseSlug}-the-movie-part-1/`,
          `${BASE}/peliculas/${baseSlug}-the-movie-part-2/`,
          // Variantes con sufijos de país: boys-over-flowers-thailand, boys-over-flowers-thai...
          ...countrySuffixes.map(c => `${BASE}/doramas/${baseSlug}-${c}/`),
          // Variantes con prefijos alternativos conocidos: f4-thailand-boys-over-flowers
          ...countrySuffixes.map(c => `${BASE}/doramas/${c}-${baseSlug}/`),
        ];

        const found = [];
        await Promise.all(candidateUrls.map(async (url) => {
          const title = await fetchRealTitle(url);
          if (title) found.push({ title, url, quality: "Sub Español", thumbnail: "" });
        }));

        return found;
      };

      // ── Ejecutar búsquedas principales en paralelo ───────────────
      const normalize = (str) =>
        str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

      // ── Estrategia extra: API interna Next.js de DoramasMP4 ───────
      // DoramasMP4 expone un endpoint /api/search?q=QUERY que devuelve JSON puro
      const tryApiSearch = async (q) => {
        try {
          const apiUrl = `${BASE}/api/search?q=${encodeURIComponent(q)}`;
          const { data, status } = await axios.get(apiUrl, {
            headers: { ...BROWSER_HEADERS, Referer: BASE + "/", Accept: "application/json" },
            timeout: 8000,
            validateStatus: (s) => s < 500,
          });
          if (status !== 200) return [];

          // La respuesta puede ser un array directo o { results: [...] }
          const arr = Array.isArray(data) ? data
            : Array.isArray(data?.results) ? data.results
              : Array.isArray(data?.data) ? data.data
                : [];

          return arr.map((item) => {
            const pickStr = (...candidates) => {
              for (const c of candidates) {
                if (c && typeof c === "string" && c.trim() && !/^undefined$/i.test(c.trim())) return c.trim();
              }
              return "";
            };
            const rawTitle = pickStr(
              item?.name_es, item?.spanish_title, item?.titulo_espanol, item?.titulo_español,
              item?.nombre_espanol, item?.nombre_español, item?.subtitle,
              item?.alt_title, item?.title_es, item?.titulo,
              item?.spanishTitle, item?.altTitle, item?.tituloEspanol,
              item.title, item.name
            );
            const title = cleanTitle(rawTitle);
            const rawSlug = pickStr(item.slug);
            const englishTitle = pickStr(item.title, item.name);
            const slug = rawSlug || toSlug(englishTitle);
            const section = (item.type || item.tipo || "").toLowerCase().includes("pelicula") ||
              (item.type || item.tipo || "").toLowerCase().includes("movie")
              ? "peliculas" : "doramas";
            const url = slug ? `${BASE}/${section}/${slug}` : "";
            const thumbnail = item.image || item.poster || item.thumbnail || item.img || item.cover || "";
            return { title, url, quality: "Sub Español", thumbnail };
          }).filter(r =>
            r.title && r.title.length > 1 && !/^undefined$/i.test(r.title) &&
            r.url && r.url.length > 10 && !/undefined/i.test(r.url)
          );
        } catch (_) { return []; }
      };

      const queriesToTry = [query];
      const qClean = normalize(query);
      if (qClean !== query.toLowerCase()) queriesToTry.push(qClean);

      const allSearches = await Promise.all(
        queriesToTry.flatMap(q => [trySearchPage(q), tryHtmlScrape(q), tryApiSearch(q)])
      );

      let results = allSearches.flat();

      // Intentar slug directo siempre (no solo como fallback)
      // Captura casos donde el slug exacto existe pero el buscador no lo devuelve
      const slugResults = await tryDirectSlug(query);
      results.push(...slugResults);

      results = dedupe(results);

      // ── Enriquecer títulos: visitar cada página para leer name_es ──
      // La página de búsqueda devuelve items con "name" (EN) pero sin
      // "name_es". fetchRealTitle lee el __NEXT_DATA__ de cada página
      // individual donde sí existe "name_es": "Belleza verdadera".
      results = await Promise.all(results.map(async (r) => {
        const realTitle = await fetchRealTitle(r.url);
        return realTitle ? { ...r, title: realTitle } : r;
      }));

      // ── Filtro final: eliminar cualquier resultado con título/URL inválidos ──
      const isValidResult = (r) =>
        r.title &&
        typeof r.title === "string" &&
        r.title.trim().length > 1 &&
        !/^undefined$/i.test(r.title.trim()) &&
        r.url &&
        typeof r.url === "string" &&
        r.url.length > 10 &&
        !/undefined/i.test(r.url);

      results = results.filter(isValidResult);

      // ── Buscar variantes predecibles a partir de TODOS los resultados /doramas/ ─
      const doramaSlugs = [...new Set(
        results
          .filter(r => r.url.includes("/doramas/"))
          .map(r => r.url.match(/\/doramas\/([^/]+)/)?.[1]?.replace(/\/$/, ""))
          .filter(Boolean)
      )];
      if (doramaSlugs.length > 0) {
        const allExtras = await Promise.all(doramaSlugs.map(slug => tryPredictableUrls(slug)));
        results.push(...allExtras.flat().filter(isValidResult));
      }

      console.log(`[DoramasMP4] final results (${results.length}):`, results.map(r => ({ title: r.title, url: r.url })));
      return dedupe(results).filter(isValidResult).slice(0, 15);
    },
  },


  // ══════════════════════════════════════════════════════════
  //  KDRAMAS - DORAMAS — FUENTE 4 — Pandrama  (pandrama.tv)
  //  Búsqueda: /search/QUERY
  //  ⚠️  Es una SPA (React). Los resultados NO están en el HTML,
  //      sino en window.bootstrapData.loaders.searchPage.results
  //      embebido como JSON en el <script> de la página.
  // ══════════════════════════════════════════════════════════
  {
    name: "Pandrama",
    description: "Kdramas, Jdramas, Cdramas y BL — pandrama.tv",
    enabled: true,
    categoria: "kdrama",

    async search(query, axios, cheerio) {
      const BASE = "https://www.pandrama.tv";

      const searchOne = async (q) => {
        const url = `${BASE}/search/${encodeURIComponent(q)}`;

        const { data } = await axios.get(url, {
          headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
          timeout: 12000,
        });

        const results = [];

        // Los resultados vienen embebidos en window.bootstrapData dentro de un <script>
        // Usamos indexOf para extraer el JSON completo sin que una regex non-greedy lo trunque
        let bootstrapData;
        try {
          const marker = "window.bootstrapData = ";
          const start = data.indexOf(marker);
          if (start === -1) return results;
          // Encontrar el cierre del objeto balanceando llaves
          let depth = 0, i = start + marker.length, jsonStart = -1;
          for (; i < data.length; i++) {
            if (data[i] === "{") { if (depth === 0) jsonStart = i; depth++; }
            else if (data[i] === "}") { depth--; if (depth === 0) break; }
          }
          if (jsonStart === -1 || depth !== 0) return results;
          bootstrapData = JSON.parse(data.slice(jsonStart, i + 1));
        } catch (_) {
          return results;
        }

        const items =
          bootstrapData?.loaders?.searchPage?.results ||
          bootstrapData?.loaders?.searchPage?.titles ||
          [];

        for (const item of items) {
          const title = item.name || item.title;
          if (!title) continue;

          // Construir URL del título: /titles/:id/:slug  o /titulo/:id
          const id = item.id;
          const slug = (item.name || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");

          const titleUrl = `${BASE}/titulo/${id}/${slug}`;

          // Miniatura: poster de TMDB o almacenado en el propio sitio
          const thumbnail =
            (item.poster && item.poster.startsWith("http") ? item.poster : item.poster ? `${BASE}/${item.poster}` : "") ||
            "";

          // Idioma / calidad
          const quality =
            item.language === "es" ? "Latino"
              : item.language === "ko" ? "Sub Español • Coreano"
                : "Sub Español";

          results.push({
            title,
            url: titleUrl,
            quality,
            thumbnail,
          });
        }

        return results;
      }; // fin searchOne

      return searchOne(query);
    },
  },
  // ══════════════════════════════════════════════════════
  //  FUENTE 5 — DoramasLatinox  (doramaslatinox.com)
  //  WordPress + Dooplay. Búsqueda /?s=. Episodios en /episodio/<slug>-
  //  <SxE>/ con servidores resueltos vía doo_player_ajax (admin-ajax).
  //  Idiomas: LAT (flag mx) / SUB (flag ar).
  // ══════════════════════════════════════════════════════
  {
    name: "DoramasLatinox",
    description: "Doramas en Latino y Subtitulado — doramaslatinox.com",
    enabled: true,
    categoria: "kdrama",

    async search(query, axios, cheerio, options = {}) {
      const BASE = "https://doramaslatinox.com";
      const cleanQuery = query.replace(/\s*\[slugs:[^\]]+\]/, "").trim();
      const pageNum = Math.max(parseInt(options && options.page, 10) || 1, 1);
      const url = pageNum === 1
        ? `${BASE}/?s=${encodeURIComponent(cleanQuery)}`
        : `${BASE}/page/${pageNum}/?s=${encodeURIComponent(cleanQuery)}`;

      let data;
      try {
        // Este sitio es lento (~15s por página): timeout ampliado.
        const res = await axios.get(url, {
          headers: { ...BROWSER_HEADERS, Referer: BASE + "/" },
          timeout: 25000,
        });
        data = res.data;
      } catch (err) {
        console.warn(`[DoramasLatinox] Search error: ${err.message}`);
        return [];
      }
      if (!data || data.includes("challenge-platform") || data.includes("Just a moment")) return [];

      const $ = cheerio.load(data);
      const results = [];
      const seen = new Set();

      // Dooplay: .result-item con .image a /series/ o /peliculas/ y .details .title
      $(".result-item, .search-page .result-item, .w_item_b").each((_, el) => {
        const a = $(el).find("a[href*='/series/'], a[href*='/peliculas/'], a[href*='/dorama/']").first();
        const href = a.attr("href") || "";
        if (!href || seen.has(href)) return;

        const title = $(el).find(".details .title a, .data h3 a, h3 a").first().text().trim()
          || a.find("img").attr("alt") || "";
        if (!title || title.length < 2) return;
        seen.add(href);

        const img = $(el).find("img").first();
        const thumbnail = img.attr("src") || img.attr("data-lazy-src") || img.attr("data-src") || "";
        const yearText = $(el).find(".meta .year, .year").first().text().trim().match(/(19|20)\d{2}/);
        const year = yearText ? yearText[0] : "";
        const isSerie = href.includes("/series/") || href.includes("/dorama/");

        results.push({
          title,
          url: href.startsWith("http") ? href : BASE + href,
          year,
          quality: isSerie ? "Serie" : "Película",
          thumbnail,
          kind: isSerie ? "series" : "movie",
          category: isSerie ? "Serie" : "Película",
          mediaType: isSerie ? "series" : "movie",
        });
      });

      // Fallback: enlaces directos si el tema no usa .result-item
      if (results.length === 0 && pageNum === 1) {
        $("a[href*='/series/'], a[href*='/peliculas/']").each((_, el) => {
          const href = $(el).attr("href") || "";
          if (seen.has(href)) return;
          seen.add(href);
          const title = $(el).find("img").attr("alt") || $(el).text().trim();
          if (!title || title.length < 3 || isNavLink(title)) return;
          const isSerie = href.includes("/series/");
          results.push({
            title,
            url: href.startsWith("http") ? href : BASE + href,
            year: "",
            quality: isSerie ? "Serie" : "Película",
            thumbnail: $(el).find("img").attr("src") || "",
            kind: isSerie ? "series" : "movie",
            category: isSerie ? "Serie" : "Película",
            mediaType: isSerie ? "series" : "movie",
          });
        });
      }

      return results;
    },
  },
];
