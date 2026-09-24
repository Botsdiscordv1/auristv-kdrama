/**
 * services/anime-titles.js
 * Resolución de títulos de kdramas/películas desde TMDB y MDL.
 * Pruned for the kdramas server partition.
 */

const axios = require("axios");
const cheerio = require("cheerio");
const { cleanTitle } = require("../utils/helpers");
const { getTMDBKey } = require("../utils/config");

async function getMovieTitles(query) {
  if (!getTMDBKey()) return { movie: null, tv: null, extra: [] };

  const normalize = (str) =>
    str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

  try {
    const { data } = await axios.get("https://api.themoviedb.org/3/search/multi", {
      params: { api_key: getTMDBKey(), query, language: "es-MX" },
      timeout: 10000,
    });

    const results = data.results || [];
    const movie = results.find(r => r.media_type === "movie");
    const tv = results.find(r => r.media_type === "tv");

    const extra = results
      .filter(r => r.media_type !== "movie" && r.media_type !== "tv")
      .map(r => r.title || r.name)
      .filter(Boolean);

    const movieTitle = movie?.title || movie?.name || null;
    const tvTitle = tv?.name || tv?.original_name || null;

    if (movie?.id) {
      try {
        const { data: altData } = await axios.get(`https://api.themoviedb.org/3/movie/${movie.id}/alternative_titles`, {
          params: { api_key: getTMDBKey() },
          timeout: 4000,
        });
        const spanishTitles = (altData.titles || [])
          .filter(t => ["AR", "MX", "ES", "CL", "CO", "PE"].includes(t.iso_3166_1))
          .map(t => t.title)
          .filter(t => t && t !== movieTitle);
        for (const st of spanishTitles) {
          if (!extra.includes(st)) extra.push(st);
        }
      } catch {}
    }

    console.log(`[MovieTitles] "${query}" → Movie="${movieTitle}" TV="${tvTitle}" extra=${JSON.stringify(extra)}`);
    return { movie: movieTitle, tv: tvTitle, extra, movieId: movie?.id, tvId: tv?.id };
  } catch (err) {
    console.warn(`[MovieTitles] Error: ${err.message}`);
    return { movie: null, tv: null, extra: [] };
  }
}
async function getAlternativeTitles(query) {
  const MDL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  const normalize = (str) =>
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const isLatin = (str) => /^[\u0000-\u024f\u1e00-\u1eff\s\d\p{P}]+$/u.test(str);

  const looksSpanish = (str) => /[áéíóúüñ¿¡]/i.test(str) ||
    /\b(la|el|los|las|de|del|verdadera|belleza|amor|vida|rey|reina|escalera|cielo)\b/i.test(str);

  try {
    const searchUrl = `https://mydramalist.com/search?q=${encodeURIComponent(query)}&adv=titles`;
    const { data } = await axios.get(searchUrl, {
      headers: MDL_HEADERS,
      timeout: 8000,
    });

    const $ = cheerio.load(data);
    const qNorm = normalize(query);

    const firstResult = $("h6.title a, .film-search-item h6 a, .box.film-search-item a.title").first();
    const detailHref = firstResult.attr("href") || "";
    const firstTitle = firstResult.text().trim();

    const nativeTitle = $(".film-search-item .native-title, .film-search-item small, h6.title + small")
      .first().text().trim();

    const candidates = new Map();

    const addCandidate = (t) => {
      if (!t || t.length < 2) return;
      t = t.replace(/\s*\(\d{4}\)\s*/g, "").trim();
      const n = normalize(t);
      if (n === qNorm) return;
      if (!isLatin(t)) return;
      if (candidates.has(n)) return;
      candidates.set(n, t);
    };

    addCandidate(firstTitle);
    addCandidate(nativeTitle);

    if (detailHref) {
      try {
        const detailUrl = detailHref.startsWith("http") ? detailHref : `https://mydramalist.com${detailHref}`;
        const { data: detail } = await axios.get(detailUrl, {
          headers: MDL_HEADERS,
          timeout: 8000,
        });
        const $d = cheerio.load(detail);

        $d("li.list-item").each((_, el) => {
          const label = $d(el).find("b").first().text().toLowerCase();
          if (!label.includes("known as") && !label.includes("native title") && !label.includes("also")) return;

          const raw = $d(el).text().replace($d(el).find("b").text(), "").trim();
          raw.split(/[,;\n]/).forEach(t => addCandidate(t.trim()));
        });
      } catch (_) {}
    }

    const allTitles = [...candidates.values()];
    const qWords = qNorm.split(/\s+/).filter(w => w.length > 3);
    const allTitlesNorm = [firstTitle, ...allTitles].map(t => normalize(t));

    const ES_EN_MAP = {
      "belleza": ["beauty"], "verdadera": ["true"], "hermosa": ["beautiful", "beauty"],
      "hermoso": ["beautiful"], "deseos": ["wishes", "wish"], "deseo": ["wish", "desire"],
      "suerte": ["luck", "lucky"], "destino": ["destiny", "fate"], "promesa": ["promise"],
      "milagro": ["miracle"], "amor": ["love", "romance"], "corazon": ["heart"],
      "beso": ["kiss"], "mentira": ["lie", "liar"], "secreto": ["secret"],
      "luna": ["moon"], "sol": ["sun"], "estrella": ["star"], "fuego": ["fire"],
      "viento": ["wind"], "cielo": ["sky", "heaven"], "sombra": ["shadow"],
      "sangre": ["blood"], "rey": ["king"], "reina": ["queen"],
      "princesa": ["princess"], "principe": ["prince"], "heroe": ["hero"],
      "angel": ["angel"], "diablo": ["devil", "demon"], "doctor": ["doctor"],
      "chef": ["chef"], "chicos": ["boys"], "chicas": ["girls"],
      "hombre": ["man"], "mujer": ["woman"], "familia": ["family"],
      "hermano": ["brother"], "hermana": ["sister"], "madre": ["mother", "mom"],
      "padre": ["father", "dad"], "casa": ["house", "home"], "ciudad": ["city"],
      "escuela": ["school"], "noche": ["night"], "verano": ["summer"],
      "invierno": ["winter"], "tiempo": ["time", "weather"], "mundo": ["world"],
      "vida": ["life"], "muerte": ["death", "dead"], "guerra": ["war"],
      "poder": ["power"], "magia": ["magic"], "flores": ["flowers"],
      "flor": ["flower"], "matar": ["kill"], "mataran": ["kill"],
    };

    const hasDirectMatch = qWords.length === 0 || qWords.some(w =>
      allTitlesNorm.some(t => t.includes(w))
    );

    const hasTranslatedMatch = qWords.some(w => {
      const translations = ES_EN_MAP[w];
      if (!translations) return false;
      return translations.some(eng => allTitlesNorm.some(t => t.includes(eng)));
    });

    if (!hasDirectMatch && !hasTranslatedMatch) {
      console.log(`[MDL] Resultado irrelevante para "${query}", activando fallback TMDB...`);
      return getTitlesFromTMDB(query);
    }

    const enTitles = allTitles.filter(t => !looksSpanish(t));
    const esTitles = allTitles.filter(t => looksSpanish(t));

    const enFromFirst = isLatin(firstTitle) && !looksSpanish(firstTitle) ? firstTitle : null;
    const en = enFromFirst || enTitles[0] || null;
    const es = esTitles[0] || null;

    console.log(`[MDL] "${query}" → EN="${en}" ES="${es}"`);

    if (!en && !es) {
      console.log(`[MDL] Sin resultados, intentando TMDB y Pandrama...`);
      const tmdb = await getTitlesFromTMDB(query);
      if (tmdb.en || tmdb.es) return tmdb;
      return { es: null, en: null };
    }

    return { es, en };
  } catch (err) {
    console.error(`[MDL] Error: ${err.message}`);
    return getTitlesFromTMDB(query);
  }
}

async function getTitlesFromTMDB(query) {
  if (!getTMDBKey()) {
    console.warn("[TMDB] TMDB_API_KEY no configurada.");
    return { es: null, en: null };
  }
  try {
    const search = await axios.get("https://api.themoviedb.org/3/search/tv", {
      params: { api_key: getTMDBKey(), query, language: "es-MX" },
      timeout: 6000,
    });
    const item = search.data.results?.[0];
    if (!item) return { es: null, en: null };

    const alts = await axios.get(`https://api.themoviedb.org/3/tv/${item.id}/alternative_titles`, {
      params: { api_key: getTMDBKey() },
      timeout: 6000,
    });

    const titles = alts.data.results || [];
    const esAlt = titles.find(t =>
      ["ES", "MX", "AR", "CO", "CL", "PE", "VE"].includes(t.iso_3166_1)
    )?.title || null;
    const esFromName = item.name && item.name !== item.original_name ? item.name : null;
    const es = esAlt || esFromName || null;
    const en = titles.find(t => t.iso_3166_1 === "US")?.title || item.original_name || item.name || null;

    const esClean = cleanTitle(es);
    const enClean = cleanTitle(en);
    console.log(`[TMDB] "${query}" → EN="${enClean}" ES="${esClean}"`);
    return { es: esClean, en: enClean };
  } catch (err) {
    console.error(`[TMDB] Error: ${err.message}`);
    return { es: null, en: null };
  }
}

module.exports = { getMovieTitles, getAlternativeTitles };
