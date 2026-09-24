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
};
