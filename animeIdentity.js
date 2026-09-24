/**
 * animeIdentity.js
 * Capa centralizada de identidad y canonicalización de títulos de anime.
 */

const TITLE_ALIASES = {
  "attack on titan": "shingeki-no-kyojin",
  "ataque a los titanes": "shingeki-no-kyojin",
  "snk": "shingeki-no-kyojin",
  "kimetsu no yaiba": "demon-slayer",
  "demon slayer": "demon-slayer",
  "guardianes de la noche": "demon-slayer",
  "boku no hero academia": "my-hero-academia",
  "my hero academia": "my-hero-academia",
  "nanatsu no taizai": "seven-deadly-sins",
  "the seven deadly sins": "seven-deadly-sins",
  "los siete pecados capitales": "seven-deadly-sins",
  "shokugeki no souma": "food-wars",
  "food wars": "food-wars",
  "tate no yuusha no nariagari": "shield-hero",
  "the rising of the shield hero": "shield-hero",
  "el ascenso del heroe del escudo": "shield-hero",
  "kanojo okarishimasu": "rent-a-girlfriend",
  "rent a girlfriend": "rent-a-girlfriend",
  "yofukashi no uta": "call-of-the-night",
  "call of the night": "call-of-the-night",
  "mushoku tensei": "mushoku-tensei",
  "mushoku tensei: job-less reincarnation": "mushoku-tensei",
  "tensei shitara slime datta ken": "ten-ura-slime",
  "that time i got reincarnated as a slime": "ten-ura-slime",
  "kage no jitsuryokusha ni naritakute": "the-eminence-in-shadow",
  "the eminence in shadow": "the-eminence-in-shadow"
};

const PROMO_PATTERNS = /\b(opening|ending|op|ed|theme|ost|promo|pv|cm|commercial|campaign|collaboration|manner\s*movie|digest|recap|preview|trailer|teaser|entrevista|interview|event|special\s*event|web\s*preview|making\s*of)\b/i;

const TYPE_PRIORITY = {
  "TV": 100,
  "Movie": 80,
  "OVA": 60,
  "ONA": 50,
  "Special": 40,
  "Promo": 0
};

/**
 * Normaliza un título para IDENTIDAD (Agresivo).
 * Elimina temporadas, partes, símbolos y aliases para encontrar la franquicia base.
 */
function normalizeForIdentity(str) {
  if (!str) return "";
  return str.toLowerCase()
    .replace(/×/g, "x") // Unificar "×" con "x" (Spy x Family, Hunter x Hunter)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Eliminar temporadas y partes
    .replace(/\b(temporada|season|part|parte|cour|final\s*season|s)\b\s*\d+/gi, "")
    // Eliminar ruido común en slugs/títulos de scrapers
    .replace(/\b(latino|sub|espanol|neutro|capitulos|descargar|online|hd|tv|movie|pelicula|especial|ova|ona)\b/gi, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Normaliza un título para DISPLAY (Conservador).
 * Mantiene Temporadas, Partes, Movies y Arcos.
 */
function normalizeForDisplay(str) {
  if (!str) return "";
  return str
    .replace(/_|-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Extrae la identidad de un título o URL de forma aislada.
 */
function parseAnimeIdentity(sourceTitle, sourceUrl = "", sourceSource = "") {
  // 1. Determinar Franquicia (Slug Canonical)
  const normTitle = normalizeForIdentity(sourceTitle);
  const normUrl = normalizeForIdentity(sourceUrl.replace(/\/+$/, "").split("/").pop() || "");
  
  let franchise = normUrl || normTitle;
  
  // Aplicar Aliases
  for (const [alias, canonical] of Object.entries(TITLE_ALIASES)) {
    const normAlias = normalizeForIdentity(alias);
    if (normTitle.includes(normAlias) || normUrl.includes(normAlias)) {
      franchise = canonical;
      break;
    }
  }

  // 2. Detección de Temporada / Parte / Cour (Priorizar URL/Slug)
  let season = null;
  let part = null;
  let cour = null;
  let finalSeason = false;

  // Combinar Título y URL para la detección, priorizando URL si hay conflicto
  const detectionSource = `${sourceTitle} ${sourceUrl.split("/").pop() || ""}`;

  // Temporada: Season 3, Temporada 3, 3rd Season, S3, Temporada3, Season1
  const sMatch = detectionSource.match(/(?:Season|Temporada|S)\s*(\d+)/i) || 
                 detectionSource.match(/(\d+)(?:st|nd|rd|th)\s*Season/i);
  if (sMatch) season = parseInt(sMatch[1], 10);

  // Romanos: "Mushoku Tensei II" → S2, "Mushoku Tensei III" → S3
  if (season === null) {
    const ROMAN_MAP = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    const romanVals = Object.keys(ROMAN_MAP).filter(r => r !== "I"); // I lo dejamos al default
    const rMatch = detectionSource.match(new RegExp(`\\b(${romanVals.join("|")})\\b`, "i"));
    if (rMatch) season = ROMAN_MAP[rMatch[1].toUpperCase()];
  }

  // Parte: Part 2, Parte 2, Cour 2, Parte2, Part1
  const pMatch = detectionSource.match(/(?:Part|Parte)\s*(\d+)/i);
  if (pMatch) part = parseInt(pMatch[1], 10);

  // Cour: Cour 2, 2nd Cour
  const cMatch = detectionSource.match(/(?:Cour)\s*(\d+)/i) ||
                 detectionSource.match(/(\d+)(?:st|nd|rd|th)\s*Cour/i);
  if (cMatch) cour = parseInt(cMatch[1], 10);

  if (detectionSource.toLowerCase().includes("final season")) {
    finalSeason = true;
    if (!season) season = 4; // Generalmente las Final Season son S4+ (ej: AOT)
  }

  // 3. Determinar Tipo (Multi-idioma, Priorizar URL)
  let type = "TV";
  let isMovie = false;
  let isOVA = false;
  let isSpecial = false;
  let isPromo = false;

  const lowerSource = detectionSource.toLowerCase();

  // Película: Movie, Película, Gekijouban
  if (lowerSource.includes("movie") || lowerSource.includes("pelicula") || 
      lowerSource.includes("película") || lowerSource.includes("gekijouban")) {
    type = "Movie";
    isMovie = true;
  } else if (lowerSource.includes("ova")) {
    type = "OVA";
    isOVA = true;
  } else if (lowerSource.includes("ona")) {
    type = "ONA";
  } else if (lowerSource.includes("special") || lowerSource.includes("especial") || /\bhen\b/.test(lowerSource) || lowerSource.includes("recap")) {
    type = "Special";
    isSpecial = true;
  }

  if (PROMO_PATTERNS.test(detectionSource)) {
    isPromo = true;
  }

  // 4. Detección de Arco o Nombre Especial (Priorizar URL)
  let arc = null;
  const arcPatterns = [
    /Final[-\s]*Season/i,
    /Stone[-\s]*Wars/i,
    /New[-\s]*World/i,
    /Science[-\s]*Future/i,
    /Lost[-\s]*Girls/i,
    /Kuinaki[-\s]*Sentaku/i,
    /Code[-\s]*White/i,
    /Shimetsu[-\s]*Kaiyuu/i,
    /Culling[-\s]*Game/i,
    /Great[-\s]*Raitai/i
  ];
  for (const pattern of arcPatterns) {
    const match = detectionSource.match(pattern);
    if (match) {
      arc = match[0].toLowerCase().replace(/[-\s]+/g, "-");
      break;
    }
  }

  // 5. Scoring y Ajuste de Temporada por Defecto
  if (season === null && !isMovie && !isOVA && !isSpecial && !isPromo) {
    season = 1;
  }

  // 6. Orden Cronológico y Relevancia (Timeline Driven)
  const TYPE_ORDER_MAP = {
    "TV": 1,
    "Movie": 3,
    "OVA": 4,
    "ONA": 2, // Generalmente partes de series
    "Special": 5,
    "Promo": 999
  };

  // Cálculo de timelineOrder (Estructura Canónica)
  // Ej: S1 = 1.0, Part 2 = 1.5, S2 = 2.0, Movie = 2.8, S3 = 3.0
  let timelineOrder = (season || 1);
  
  // Ajuste por arco conocido (Hardcoded Timeline mapping)
  if (arc) {
    if (arc.includes("code-white")) timelineOrder = 2.8;
    if (arc.includes("final-season")) timelineOrder = 98;
    if (arc.includes("kanketsu")) timelineOrder = 100;
  } else {
    // Ajustes genéricos
    if (part > 1 || cour > 1) timelineOrder += 0.5;
    if (isMovie) {
       // Si es película y no tiene arco específico, ponerla al final de su temporada detectada
       timelineOrder += 0.8; 
    }
    if (isOVA || isSpecial) timelineOrder += 0.9;
  }

  // Si tiene Part o Cour, es prioridad 2 (después de la serie base pero antes de películas)
  let typeOrder = TYPE_ORDER_MAP[type] || 50;
  if (part || cour) typeOrder = 2;

  let score = TYPE_PRIORITY[type] || 50;
  if (isPromo) score -= 999;
  
  if (season && season > 1) score += 5;
  if (part) score += 2;

  return {
    franchise,
    canonical: franchise,
    displayTitle: normalizeForDisplay(sourceTitle),
    sourceTitle,
    sourceUrl,
    source: sourceSource,
    season: season || 1,
    part: part || 0,
    cour: cour || 0,
    year: null, 
    releaseDate: null,
    releaseTimestamp: null,
    type,
    typeOrder,
    timelineOrder,
    isMovie,
    isOVA,
    isSpecial,
    isPromo,
    finalSeason,
    arc,
    score,
    slug: normUrl || franchise
  };
}

/**
 * Centraliza y deduplica una lista de resultados de anime.
 */
function processAnimeResults(results, query) {
  // 1. Convertir cada resultado en una Identidad
  const identities = results.map(r => {
    const identity = parseAnimeIdentity(r.title, r.url, r.source);
    // Preservar el año y fecha completa si el scraper lo proveyó
    if (r.year) identity.year = r.year;
    if (r.fullDate) {
      identity.releaseDate = r.fullDate;
      const ts = new Date(r.fullDate).getTime();
      if (!isNaN(ts)) identity.releaseTimestamp = ts;
    }
    return {
      ...r,
      identity
    };
  });

  // 2. Agrupar por Identidad Unica (Source + Franquicia + Temporada + Parte + Tipo)
  const identityMap = new Map();

  identities.forEach(item => {
    const id = item.identity;
    // Clave ultra-específica para evitar colapsos visuales
    // Incluye id.slug para diferenciar entradas con distinta URL que comparten
    // franquicia/temporada/parte/tipo (ej: "mushoku-tensei-ii-..." vs "...-2nd-season").
    const key = `${item.source}|${id.franchise}|S${id.season || 1}|P${id.part || 0}|C${id.cour || 0}|T${id.type}|${id.arc || ""}|${id.slug || ""}`;
    
    const existing = identityMap.get(key);
    
    // Si ya existe en la MISMA fuente, nos quedamos con el que tenga mejor score
    if (!existing || id.score > existing.identity.score) {
      identityMap.set(key, item);
    }
  });

  return Array.from(identityMap.values())
    .sort((a, b) => b.identity.score - a.identity.score);
}

module.exports = {
  parseAnimeIdentity,
  processAnimeResults,
  TITLE_ALIASES,
  normalizeForDisplay,
  normalizeForIdentity
};
