/**
 * utils/helpers.js
 * Pure utility functions used across CineBot modules.
 */

function normalizeStr(str) {
  return str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
}

function cleanTitle(t) {
  if (!t) return t;
  return t.replace(/[\u2026\.]{2,}$/, '').replace(/[\s\-\u2013:,]+$/, '').trim();
}

function toSlugBasic(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractSlug(url = "") {
  const cleanUrl = (url || "").split("?")[0].split("#")[0];
  return cleanUrl
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.toLowerCase() || "";
}

function normalizeSlug(slug = "") {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function parseAnimeContinuation(title) {
  if (!title) return { type: "base", number: null };
  const t = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const isFinal = /final\s*season|temporada\s*final|kanketsu/i.test(t);

  const parseRoman = (s) => {
    const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    return romanMap[s] || null;
  };

  const ORDINAL_MAP = { primera: 1, segunda: 2, tercer: 3, tercera: 3, cuarta: 4, quinta: 5 };
  const partMatch = t.match(/(?:part|parte|cour)\s*(\d+)/i)
    || t.match(/(\d+)(?:st|nd|rd|th)\s*(?:part|parte|cour)/i)
    || t.match(/(?:part|parte|cour)\s*([ivxlcdm]+)/i)
    || t.match(/(segunda|tercera|cuarta|quinta|primera)\s+(?:parte|part|temporada)/i)
    || t.match(/(\d+)(?:a|o|ª|º)?\s+(?:parte|part|temporada)/i);
  if (partMatch) {
    const raw = partMatch[1].toLowerCase();
    const roman = parseRoman(raw);
    const ordinal = ORDINAL_MAP[raw];
    const num = roman || ordinal || parseInt(raw, 10);
    if (!isNaN(num)) return { type: "part", number: num, finalSeason: isFinal };
  }

  const seasonMatch = t.match(/(?:season|temporada|cour)\s*(\d+)/i)
    || t.match(/(\d+)(?:st|nd|rd|th)\s*season/i)
    || t.match(/s(\d{1,2})(?:\s|$|:)/i)
    || t.match(/(segunda|tercera|cuarta|quinta|primera)\s+(?:temporada)/i)
    || t.match(/\s+(\d+)(?:st|nd|rd|th)?$/i)
    || t.match(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)(?:\s*[:–\-]|$)/i);
  if (seasonMatch) {
    const raw = seasonMatch[1].toLowerCase();
    const ordinal = ORDINAL_MAP[raw];
    const num = ordinal || parseRoman(raw) || parseInt(raw, 10);
    if (!isNaN(num) && num > 0 && num < 30) return { type: "season", number: num, finalSeason: isFinal };
  }

  if (isFinal) return { type: "season", number: null, finalSeason: true };

  return { type: "base", number: null, finalSeason: false };
}

function extractFranchiseRoot(title) {
  if (!title) return "";
  return title
    .replace(/\s*[:\-\u2013\u2014|].*$/g, "")
    .replace(/\s+(?:Season|Temporada|Part|Parte|Cour|Split\s*Cour|S\d+|Final\s*Season|Kanketsu).*$/gi, "")
    .replace(/\s+(?:\d+(?:st|nd|rd|th)\s+(?:Season|Part|Parte|Cour)).*$/gi, "")
    .replace(/\s+(\d+)(?:st|nd|rd|th)?$/gi, "")
    .replace(/\s+(?:Winter|Summer|Fall|Spring)\s+Arc.*$/gi, "")
    .replace(/\s+(?:Arc|Hen|Saga|Capitulo|Cap\u00edtulo).*$/gi, "")
    .replace(/\s+(?:Movie|Film|OVA|ONA|Special|Specials|TV\s*Special).*$/gi, "")
    .replace(/\s*第\d+(?:期|シリーズ|クール|部).*$/g, "")
    .trim();
}

function translateSeason(t) {
  if (!t) return t;
  return t
    .replace(/(\d+)(?:st|nd|rd|th)[-\s]+season/gi, "Temporada $1")
    .replace(/season[-\s]+(\d+)/gi, "Temporada $1")
    .replace(/(\d+)nd[-\s]+season/gi, "Temporada $1")
    .replace(/part[-\s]+(\d+)/gi, "Parte $1")
    .replace(/(\d+)nd[-\s]+parte?/gi, "Temporada $1")
    .replace(/(\d+)(?:st|nd|rd|th)/gi, "$1")
    .replace(/Final[-\s]+Season/gi, "Temporada Final")
    .trim();
}

function normalizeAnimeFormats(anime) {
  const formats = new Set();

  const baseType = (anime.metadataType || anime.type || anime.format || "TV").toUpperCase().trim();
  const quality = (anime.quality || "").toLowerCase();
  const title = (anime.title || "").toLowerCase();

  if (["TV", "MOVIE", "OVA", "ONA", "SPECIAL"].includes(baseType)) {
    formats.add(baseType);
  }

  const isHybridSeries = /sakamoto days/.test(title);
  if (isHybridSeries) {
    formats.add("TV");
    formats.add("ONA");
  }

  if (anime.type && anime.type.toUpperCase() !== baseType) {
    const st = anime.type.toUpperCase();
    if (["TV", "MOVIE", "OVA", "ONA", "SPECIAL"].includes(st)) formats.add(st);
  }

  if (formats.size === 0) formats.add("TV");

  if (formats.has("TV")) {
    if (quality.includes("ona") || quality.includes("netflix") || quality.includes("web") || quality.includes("streaming")) {
      formats.add("ONA");
    }
  } else if (formats.has("ONA")) {
    if (quality.includes("tv") || quality.includes("anime-tv")) {
      formats.add("TV");
    }
  }

  if (formats.has("MOVIE") || formats.has("SPECIAL") || formats.has("OVA")) {
    const principal = formats.has("MOVIE") ? "MOVIE" : (formats.has("SPECIAL") ? "SPECIAL" : "OVA");
    return [principal];
  }

  const order = ["TV", "ONA", "OVA", "MOVIE", "SPECIAL"];
  return Array.from(formats).sort((a, b) => {
    const idxA = order.indexOf(a) === -1 ? 99 : order.indexOf(a);
    const idxB = order.indexOf(b) === -1 ? 99 : order.indexOf(b);
    return idxA - idxB;
  });
}

function dedupeByUrl(primary, secondary) {
  const seen = new Set(primary.map(r => r.url.replace(/\/+$/, "").toLowerCase()));
  return secondary.filter(r => {
    const key = r.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function isPromotionalEntry(title = "") {
  return /\b(campaign|ayataka|hotto\ hitoiki|collaboration|advertisement|promo|manner\ movie)\b/i.test(title);
}

function isReleasedAnime(entry) {
  if (!entry) return true;
  if (!entry.status) return true;
  const status = String(entry.status).toLowerCase();
  const unreleased = ["not_yet_released", "upcoming", "tba", "unreleased", "not yet aired"];
  return !unreleased.includes(status);
}

function buildFranchiseMap(entries = []) {
  if (!entries || !Array.isArray(entries)) return [];
  return entries
    .filter(entry => {
      const title = entry.title_english || entry.title || entry.title_romaji || "";
      if (isPromotionalEntry(title)) return false;
      if (!isReleasedAnime(entry)) return false;
      return true;
    })
    .map(entry => ({
      title: entry.title_english || entry.title || entry.title_romaji || "",
      type: entry.type || "TV",
      season: entry.seasonNumber || null,
      year: entry.year || null,
      synonyms: entry.synonyms || []
    }));
}

function normalizeLanguageQuality(qualityStr) {
  if (!qualityStr) return "";
  let q = qualityStr.replace(/\s*[•\-\/]\s*/g, " • ").replace(/\s+/g, " ");
  let tags = q.split(" • ").map(t => t.trim()).filter(Boolean);
  const isEsp = (t) => /^espa[ñn]ol$/i.test(t) || /^esp$/i.test(t) || /^spanish$/i.test(t);
  const isLat = (t) => /^latino$/i.test(t) || /^lat$/i.test(t) || /^latam$/i.test(t);
  const isEspLat = (t) =>
    /espa[ñn]ol\s+latino/i.test(t) ||
    /latino\s+espa[ñn]ol/i.test(t) ||
    /spanish\s+latam/i.test(t) ||
    /esp\s+lat/i.test(t) ||
    /castellano\s+latino/i.test(t);
  const hasEsp = tags.some(isEsp);
  const hasLat = tags.some(isLat);
  const hasEspLat = tags.some(isEspLat);
  if ((hasEsp && hasLat) || hasEspLat) {
    const filtered = tags.filter(t => !isEsp(t) && !isLat(t) && !isEspLat(t));
    tags = ["Latino", ...filtered];
  }
  return [...new Set(tags)].map(t => t.trim()).filter(t => t.length > 0).join(" • ");
}

/**
 * DoramasYT publica 2 variantes por título: Sub Español y Latino.
 * El idioma va en el slug de la ficha (/dorama/...-latino-sub-espanol o ...-sub-espanol)
 * y en el título ("Hotel del Luna Latino"). Las URLs /ver/ no lo traen:
 * hay que mirar el link de serie en la página del episodio.
 * @returns {"Latino"|"Sub Español"|""}
 */
function detectDoramasYTLang(url = "", title = "", html = "") {
  const t = String(title || "");
  const u = String(url || "").toLowerCase();
  const isLatinoSlug = (s) => /-latino(-|\/|$)/.test(s) || s.includes("-latino-sub-espanol");
  const isSubSlug = (s) => s.includes("-sub-espanol") || s.includes("-sub-espa");

  // Título marcado como variante latino ("... Latino", "Latino (...)")
  if (/(?:^|[\s(])Latino(?:$|[\s).,!?:])/i.test(t)) return "Latino";

  // Slug de la ficha en la URL pedida
  if (isLatinoSlug(u)) return "Latino";
  if (isSubSlug(u)) return "Sub Español";

  // Página de episodio /ver/: usar el link canónico de la ficha (serie)
  if (html) {
    const m = String(html).match(/doramasyt\.com\/dorama\/([^"'?\s\\]+)/i);
    if (m) {
      const seriesSlug = m[1].toLowerCase();
      if (isLatinoSlug(seriesSlug)) return "Latino";
      if (isSubSlug(seriesSlug)) return "Sub Español";
    }
    const seriesHref = String(html).match(/href="(https?:\/\/www\.doramasyt\.com\/dorama\/[^"]+)"/i);
    if (seriesHref) {
      const su = seriesHref[1].toLowerCase();
      if (isLatinoSlug(su)) return "Latino";
      if (isSubSlug(su)) return "Sub Español";
    }
  }

  if (/-sub-espanol/.test(u) || /sub[- ]?espa[ñn]ol/i.test(t)) return "Sub Español";
  if (u.includes("doramasyt.com")) return "Sub Español";
  return "";
}

/**
 * Normalize media kind for search/detail payloads.
 * Returns { type: "Series"|"Movie", kind: "Dorama"|"movie_dorama" }.
 * Accepts legacy fields (kind: series|movie, mediaType: tv|movie, quality).
 * Defaults to Series/Dorama (this server is dorama-focused).
 */
function annotateKindType(item = {}) {
  const url = (item.url || "").toLowerCase();
  const quality = (item.quality || "").toLowerCase();
  const kind = String(item.kind || "").toLowerCase();
  const mediaType = String(item.mediaType || "").toLowerCase();
  const type = String(item.type || "").toLowerCase();

  let isMovie = false;

  if (type === "movie" || type === "película" || type === "pelicula") {
    isMovie = true;
  } else if (type === "series" || type === "serie" || type === "dorama") {
    isMovie = false;
  } else if (kind === "movie" || kind === "movie_dorama" || mediaType === "movie") {
    isMovie = true;
  } else if (kind === "series" || kind === "dorama" || mediaType === "tv" || mediaType === "series") {
    isMovie = false;
  } else if (/\/(peliculas?|movies?)(\/|$)/.test(url) || /\b(pelicula|movie)\b/.test(quality)) {
    isMovie = true;
  } else if (/\/(series?|doramas?|capitulos?|episodios?|titulo)(\/|$)/.test(url) || /\b(serie|dorama)\b/.test(quality)) {
    isMovie = false;
  }

  return {
    type: isMovie ? "Movie" : "Series",
    kind: isMovie ? "movie_dorama" : "Dorama",
    mediaType: isMovie ? "movie" : "tv",
  };
}

module.exports = {
  normalizeStr,
  cleanTitle,
  toSlugBasic,
  extractSlug,
  normalizeSlug,
  parseAnimeContinuation,
  extractFranchiseRoot,
  translateSeason,
  normalizeAnimeFormats,
  dedupeByUrl,
  isPromotionalEntry,
  isReleasedAnime,
  buildFranchiseMap,
  normalizeLanguageQuality,
  detectDoramasYTLang,
  annotateKindType,
};
