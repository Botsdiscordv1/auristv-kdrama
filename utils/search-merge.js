const { extractSlug, normalizeSlug } = require('./helpers');

function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSeasonNumber(text = '') {
  const s = text.toString().toLowerCase();

  // 1. Patrones estándar (Season 2, Temporada 2, etc.)
  let m = s.match(/(?:season|temporada|part|parte|cour)\s*(\d+)\b/i)
    || s.match(/(\d+)(?:st|nd|rd|th)\s*(?:season|temporada|part|parte|cour)\b/i)
    || s.match(/\bs(\d{1,2})\b/i);
  if (m) {
    const num = parseInt(m[1], 10);
    if (num >= 1) return num;
  }

  // 2. Romanos al final o precedidos de espacio (II-X)
  const romanMap = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  for (const [rom, val] of Object.entries(romanMap)) {
    if (new RegExp(`\\b${rom}$`).test(s) || new RegExp(`\\s${rom}\\b`).test(s)) {
      return val;
    }
  }

  // 3. Sufijo numérico en slug (ej: "youjo-senki-2" o "youjo-senki-ii")
  const parts = s.split(/[-_\s/]/).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) {
      const num = parseInt(last, 10);
      if (num >= 2 && num < 30) return num;
    }
    if (romanMap[last]) return romanMap[last];
  }

  return null;
}

function stripSeasonSuffix(text = '') {
  return text
    .replace(/\s*[-–:—]\s*(?:\d+(?:st|nd|rd|th)?\s*(?:season|temporada|part|parte|cour)|(?:season|temporada|part|parte|cour)\s*\d+|II|III|IV|V|VI|VII|VIII|IX|X)\s*$/i, '')
    .replace(/\s+(?:\d+(?:st|nd|rd|th)?\s*(?:season|temporada|part|parte|cour)|(?:season|temporada|part|parte|cour)\s*\d+|II|III|IV|V|VI|VII|VIII|IX|X)\s*$/i, '')
    .trim();
}

const SLUG_ALIASES = {
  "my-dress-up-darling": "sono-bisque-doll-wa-koi-wo-suru",
  "my-dress-up-darling-season-2": "sono-bisque-doll-wa-koi-wo-suru-season-2",
  "the-apothecary-diaries": "kusuriya-no-hitorigoto",
  "the-apothecary-diaries-season-2": "kusuriya-no-hitorigoto-2nd-season",
  "the-apothecary-diaries-2nd-season": "kusuriya-no-hitorigoto-2nd-season",
  "demon-slayer-kimetsu-no-yaiba": "kimetsu-no-yaiba",
  "attack-on-titan": "shingeki-no-kyojin",
  "frieren-beyond-journeys-end": "sousou-no-frieren",
  "mushoku-tensei-jobless-reincarnation": "mushoku-tensei-isekai-ittara-honki-dasu",
  "mushoku-tensei-jobless-reincarnation-season-2": "mushoku-tensei-ii-isekai-ittara-honki-dasu",
  "mushoku-tensei-jobless-reincarnation-temporada-2": "mushoku-tensei-ii-isekai-ittara-honki-dasu",
  "mushoku-tensei-jobless-reincarnation-temporada-2-parte-2": "mushoku-tensei-ii-isekai-ittara-honki-dasu",
  "mushoku-tensei-jobless-reincarnation-temporada-2-parte-2-latino": "mushoku-tensei-ii-isekai-ittara-honki-dasu",
  "mushoku-tensei-temporada-2-isekai-ittara-honki-dasu-castellano-gbh3y9": "mushoku-tensei-ii-isekai-ittara-honki-dasu",
  "mushoku-tensei-jobless-reincarnation-temporada-3": "mushoku-tensei-iii-isekai-ittara-honki-dasu",
  "mushoku-tensei-jobless-reincarnation-season-3": "mushoku-tensei-iii-isekai-ittara-honki-dasu",
  "blue-lock-vs-u-20-japan": "blue-lock-2nd-season",
  "dandadan": "dan-da-dan",
  "hyakkano": "kimi-no-koto-ga-daidaidaidaidaisuki-na-100-nin-no-kanojo",
  "hyakkano-ii": "kimi-no-koto-ga-daidaidaidaidaisuki-na-100-nin-no-kanojo-2nd-season",
  "jujutsu-kaisen-tv": "jujutsu-kaisen",
  "oshi-no-ko": "idoly-pride-no-oshi-no-ko",
  "chainsaw-man": "chainsaw-man",
  "smoking-behind-the-supermarket": "super-no-ura-de-yani-suu-futari",
  "smoking-behind-the-supermarket-latino": "super-no-ura-de-yani-suu-futari",
};

function canonicalSearchKey(item, options = {}) {
  const rawSlug = item?.slug || extractSlug(item?.url || '');
  let normalizedSlug = normalizeSlug(rawSlug || '');
  const aliases = options?.slugAliases || SLUG_ALIASES;
  if (aliases[normalizedSlug]) normalizedSlug = aliases[normalizedSlug];

  const sourceTitle = item?.scrapedTitle || item?.metadataTitle || item?.title || '';
  const season = extractSeasonNumber(sourceTitle) || extractSeasonNumber(rawSlug) || null;

  // Si tiene un slug fuerte (scraper), usamos slug como clave primaria
  if (normalizedSlug && normalizedSlug.length > 5) {
    return `slug:${normalizedSlug}:s${season || 'base'}`;
  }

  // Si no tiene slug (TMDB) o es muy corto, usamos el título normalizado
  // Esto permite que el metadato se fusione con el primer scraper que coincida en título
  const coreTitle = normalizeText(stripSeasonSuffix(sourceTitle));
  if (coreTitle) return `title:${coreTitle}:s${season || 'base'}`;

  return `fallback:${normalizeText(sourceTitle) || 'unknown'}`;
}

function isMetadataThumbnail(url = '') {
  return /image\.tmdb/i.test(url);
}

function isSourceThumbnail(url = '') {
  return /cdn\.(animeav1|jkdesa)\.com/i.test(url);
}

function mergeSearchResults(results, options = {}) {
  if (!Array.isArray(results) || results.length <= 1) return results || [];

  const merged = new Map();

  for (const item of results) {
    if (!item?.url) continue;
    const key = canonicalSearchKey(item, options);
    const existing = merged.get(key);
    const itemSources = Array.isArray(item.sources) && item.sources.length > 0
      ? item.sources
      : [{ source: item.source, url: item.url, quality: item.quality || '' }];

    if (!existing) {
      merged.set(key, {
        ...item,
        sources: itemSources.map(s => ({ source: s.source, url: s.url, quality: s.quality || '' })),
        availableSources: [...new Set(itemSources.map(s => s.source).filter(Boolean))],
        _rank: item.originalIndex ?? 9999,
      });
      continue;
    }

    // ── Bloqueo de Fusión por Año (Escudo de Temporadas) ──
    // Si ambos tienen año y la diferencia es > 2, prohibimos la fusión
    // Esto evita que clásicos antiguos (Ranma 1989) se traguen remakes (Ranma 2024)
    if (existing.year && item.year) {
      const diff = Math.abs(parseInt(existing.year) - parseInt(item.year));
      if (diff > 2) {
        // Generamos una clave única para este item para que NO se fusione con el existente
        const uniqueKey = `${key}:y${item.year}`;
        merged.set(uniqueKey, {
          ...item,
          sources: itemSources.map(s => ({ source: s.source, url: s.url, quality: s.quality || '' })),
          availableSources: [...new Set(itemSources.map(s => s.source).filter(Boolean))],
          _rank: item.originalIndex ?? 9999,
        });
        continue;
      }
    }

    const sourceSet = new Set(existing.availableSources || []);
    for (const s of itemSources) {
      if (s.source) sourceSet.add(s.source);
      if (!existing.sources.some(x => x.source === s.source && x.url === s.url)) {
        existing.sources.push({ source: s.source, url: s.url, quality: s.quality || '' });
      }
    }
    existing.availableSources = [...sourceSet];

    if (item.thumbnail && (!existing.thumbnail || (isMetadataThumbnail(existing.thumbnail) && isSourceThumbnail(item.thumbnail)))) {
      existing.thumbnail = item.thumbnail;
    }
    if (item.banner && !existing.banner) existing.banner = item.banner;
    if ((!existing.year || !existing.fullDate) && (item.year || item.fullDate)) {
      if (!existing.year && item.year) existing.year = item.year;
      if (!existing.fullDate && item.fullDate) existing.fullDate = item.fullDate;
    }
    if ((!existing.metadataTitle || existing.metadataTitle.length < (item.metadataTitle || '').length) && item.metadataTitle) {
      existing.metadataTitle = item.metadataTitle;
    }
    if ((!existing.scrapedTitle || existing.scrapedTitle.length < (item.scrapedTitle || '').length) && item.scrapedTitle) {
      existing.scrapedTitle = item.scrapedTitle;
    }
    if (item.originalIndex !== undefined) existing._rank = Math.min(existing._rank ?? item.originalIndex, item.originalIndex);
  }

  return [...merged.values()]
    .sort((a, b) => (a._rank ?? 9999) - (b._rank ?? 9999))
    .map(({ _rank, ...item }) => {
      if (item.availableSources.length > 1) {
        item.sources.sort((a, b) => {
          const aLatino = (a.quality || '').toLowerCase().includes('latino') ? 0 : 1;
          const bLatino = (b.quality || '').toLowerCase().includes('latino') ? 0 : 1;
          if (aLatino !== bLatino) return aLatino - bLatino;
          const aSub = (a.quality || '').toLowerCase().includes('sub') ? 0 : 1;
          const bSub = (b.quality || '').toLowerCase().includes('sub') ? 0 : 1;
          return aSub - bSub;
        });
      }
      return item;
    });
}

module.exports = {
  canonicalSearchKey,
  extractSeasonNumber,
  mergeSearchResults,
  normalizeText,
  stripSeasonSuffix,
};
