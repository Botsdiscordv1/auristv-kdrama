/**
 * services/trailer.js
 * Sistema de búsqueda de trailers oficiales para anime y películas/series.
 * Totalmente independiente: usa YouTube scraping con scoring por publisher.
 */

const axios = require("axios");
const cheerio = require("cheerio");
const { normalizeStr, parseAnimeContinuation, extractFranchiseRoot } = require("../utils/helpers");

const TRAILER_OVERRIDES = {
  "terrifier": "vTutJ2_E1Vo",
  "terrifier 3": "cxTQ3aMYgfU",
  "return to silent hill": "lkOTF_XeEcE",
};

const preferredPublishers = new Map();

// ============================================================
//  ANIME TRAILER — getOfficialTrailer
// ============================================================

async function getOfficialTrailer(identity) {
  try {
    const skipFormats = ["PV", "CM", "MUSIC"];
    if (identity.format && skipFormats.includes(String(identity.format).toUpperCase().trim())) {
      console.log(`[Trailer] Skipped: formato ${identity.format}`);
      return null;
    }

    const romaji = identity.romaji || "";
    const english = identity.english || "";
    const title = romaji || english;
    if (!title) return null;

    const semanticNorm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").trim();
    const getDurationSeconds = (text) => {
      if (!text) return 0;
      const parts = text.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };

    const REGIONAL_DISTRIBUTORS = [
      "netflix latinoamérica", "netflix latam", "netflix anime latinoamérica", "netflix anime latino",
      "netflix brasil",
      "crunchyroll en español", "crunchyroll latam", "crunchyroll latinoamérica", "crunchyroll brasil",
      "anime onegai", "konnichiwa", "konnichiwa festival", "tms anime latino",
      "aniplex latino", "sony pictures latinoamérica", "sony pictures latino", "sony pictures latam",
      "sonypicturesméxico", "sony pictures méxico",
      "muse latam", "ani-one latino", "ani-one español", "one media español", "one media en español",
      "toho animation latam", "bandai namco latinoamérica", "warner bros latino", "warner bros latam",
      "claro video", "claro video méxico", "claro video latinoamérica", "claro video anime",
      "prime video latam", "prime video latinoamérica",
      "hbo max latino", "hbo max latam", "hbo max brasil", "max latinoamérica",
      "star+ latam", "star+ latinoamérica", "disney+ latam", "disney+ latinoamérica"
    ];

    const JP_ORIGINAL_PUBLISHERS = [
      "toho animation", "aniplex", "aniplex channel",
      "kadokawaanime", "kadokawa anime", "pony canyon", "pony canyon anime",
      "bandai namco filmworks", "bandai namco", "avex pictures", "avex",
      "emotion label channel", "king amusement creative", "nbcuuniversal anime music",
      "warner bros japan anime", "warner bros japan", "shochiku anime channel", "shochiku",
      "fuji tv", "テレビ", "tv tokyo", "テレビ朝日",
      "mbs", "tbs anime", "tbs", "ytv", "yomiuri tv", "nhk",
      "tms entertainment", "tms anime",
      "nippon animation", "science saru", "サイエンスsaru",
      "mappa channel", "mappa", "ufotable", "ufotable channel",
      "cloverworks", "a-1 pictures", "wit studio", "studio wit",
      "bones studio", "studio bones", "toei animation", "toei", "bn pictures", "bandai namco pictures",
      "kyoto animation", "kyoani", "madhouse",
      "magazine channel", "shonen jump", "jump comics", "comic meteor", "gangan online", "square enix",
      "bushiroad", "bushiroad official", "lantis", "flying dog", "victor entertainment",
      "マガジンチャンネル", "ジャンプチャンネル", "アニプレックス", "kadokawaアニメ",
      "nhk anime world", "nhk anime", "vap official channel", "vap official", "vap anime"
    ];

    const GLOBAL_EN_PUBLISHERS = [
      "crunchyroll", "crunchyroll dubs", "crunchyroll collection", "funimation", "viz media", "hidive", "anime limited", "all the anime",
      "netflix anime", "netflix", "aniplex usa", "aniplex of america", "toho animation en", "amazon prime video", "disney plus", "hulu"
    ];

    const getPublisherType = (chNorm, rawChName = "") => {
      const chNameLower = rawChName.toLowerCase();
      const hasOfficialTag = chNameLower.includes("公式") || chNameLower.includes("official") || chNameLower.includes("tvアニメ");

      if (hasOfficialTag) {
        const normalizeJp = (str) => str.replace(/[！]/g, "!").replace(/[？]/g, "?").replace(/[　]/g, " ");
        const chNameLowerJp = normalizeJp(chNameLower);

        const rootNative = identity.native ? normalizeJp(extractFranchiseRoot(identity.native)).toLowerCase() : "";
        const rootRomaji = identity.romaji ? extractFranchiseRoot(identity.romaji).toLowerCase() : "";
        const rootEnglish = identity.english ? extractFranchiseRoot(identity.english).toLowerCase() : "";

        const isAnimeDedicated =
          (rootNative && chNameLowerJp.includes(rootNative)) ||
          (identity.native && chNameLowerJp.includes(normalizeJp(identity.native).toLowerCase())) ||
          (rootRomaji && chNorm.includes(normalizeStr(rootRomaji))) ||
          (rootEnglish && chNorm.includes(normalizeStr(rootEnglish)));

        if (isAnimeDedicated) {
          console.log(`[Trailer Publisher Match] ANIME_SPECIFIC: "${rawChName}"`);
          return "ANIME_SPECIFIC";
        }
      }

      if (REGIONAL_DISTRIBUTORS.some(p => chNorm.includes(normalizeStr(p)))) return "REGIONAL";
      if (GLOBAL_EN_PUBLISHERS.some(p => chNorm.includes(normalizeStr(p)))) return "GLOBAL_EN";
      if (JP_ORIGINAL_PUBLISHERS.some(p => chNorm.includes(normalizeStr(p)))) return "JP_ORIGINAL";
      return "UNKNOWN";
    };

    const REJECT_KEYWORDS = [
      "fandub", "fan dub", "no oficial", "amv", "opening", "ending", "op", "ed",
      "clip", "reaction", "resumen", "episodio", "fanmade", "hecho por fans",
      "castellano", "español españa", "spanish spain", "es-es",
      "fans para fans", "unofficial", "doblaje fan", "fan trailer",
      "concept trailer", "concept teaser", "fan concept", "full movie", "full episode",
      "cover", "vs", "battle", "mashup", "remix", "parody", "parodia",
      "music video", "mv", "lyric video", "creditless", "theme song", "soundtrack", "ost",
      "avance semanal", "episode preview", "capitulo", "next episode",
      "fecha de estreno", "cuando sale", "anuncio", "noticias", "news",
      "nueva temporada", "new season", "release date", "cuando se estrena",
    ];

    const MIN_DURATION_ACCEPT = 30;
    const SUPER_PRIORITY = 5000000000;

    const wordingNormalize = (s) => {
      return (s || "").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\bseason\b/gi, "temporada")
        .replace(/\bpart\b/gi, "parte")
        .replace(/\bcour\b/gi, "parte")
        .replace(/\b2nd\b/gi, "2")
        .replace(/\bsecond\b/gi, "2")
        .replace(/\bfinal season\b/gi, "temporada final")
        .replace(/[||\-]/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const parseNum = (str, regexes) => {
      for (const rx of regexes) {
        const m = str.match(rx);
        if (m) {
          let val = m[1].toLowerCase();
          val = val.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
          const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
          return romanMap[val] || parseInt(val, 10);
        }
      }
      return null;
    };

    const franchiseRoot = extractFranchiseRoot(title);
    const franchiseKey = semanticNorm(franchiseRoot) || semanticNorm(title);
    const preferredChannel = preferredPublishers.get(franchiseKey);
    const isPreferredRegional = preferredChannel && getPublisherType(normalizeStr(preferredChannel)) === "REGIONAL";

    const searchQueries = [];

    // PRIORIDAD: Título Nativo + PV (Lo más oficial y rápido de encontrar)
    if (identity.native) {
      const nativeTitle = identity.native;
      searchQueries.push(`${nativeTitle} PV`);
      searchQueries.push(`${nativeTitle} 本PV`);
    }

    // Título Romaji/English + PV
    const titlesForSearch = [romaji, english].filter(t => t && t.length > 0);
    for (const t of titlesForSearch) {
      searchQueries.push(`${t} PV`);
      searchQueries.push(`${t} official trailer`);
    }

    // Opcional: Una sola búsqueda regional si se prefiere (Aligerado)
    if (titlesForSearch.length > 0) {
      const firstTitle = titlesForSearch[0];
      const tEs = firstTitle.replace(/\b(\d+)(?:st|nd|rd|th)\s+Season\b/gi, "Temporada $1").replace(/\bSeason\s*(\d+)\b/gi, "Temporada $1");
      searchQueries.push(`${tEs} tráiler oficial latino`);
    }

    const allCandidates = [];

    const scoreVideo = (v) => {
      const chName = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "";
      const chNorm = normalizeStr(chName);
      const publisherType = getPublisherType(chNorm, chName);

      if (publisherType === "GLOBAL_EN") return null;

      const VIDEO_BLACKLIST = ["NxqfMRZfVTA", "jMhzqfi9aPwe"];
      if (VIDEO_BLACKLIST.includes(v.videoId)) return null;

      const videoTitle = (v.title?.runs?.[0]?.text || "").toLowerCase();
      const videoDesc = (v.descriptionSnippet?.runs?.map(r => r.text).join(" ") || "").toLowerCase();
      const vTitleNorm = normalizeStr(videoTitle);
      const vTitleWording = wordingNormalize(videoTitle);
      const durationSec = getDurationSeconds(v.lengthText?.simpleText || "");
      const isVerified = !!v.ownerBadges;

      const officialLinks = ["netflix.com", "crunchyroll.com", "animeonegai.com", "primevideo.com", "disneyplus.com", "sony.com"];
      const officialMarkers = ["official trailer", "tráiler oficial", "suscríbete", "estreno", "disponible en", "pv", "本pv", "予告編", "announcement"];

      const rootTokens = wordingNormalize(franchiseRoot).split(/\s+/).filter(t => t.length > 2 && !["the", "and", "season", "temporada", "part", "parte", "cour", "split", "oficial", "trailer"].includes(t));

      const identityAliases = [identity.romaji, identity.english, identity.native, ...(identity.synonyms || [])]
        .filter(Boolean)
        .map(t => wordingNormalize(t));

      const matchedTokens = rootTokens.filter(token => vTitleWording.includes(token));
      const tokenRatio = rootTokens.length > 0 ? (matchedTokens.length / rootTokens.length) : 1;

      const hasAliasMatch = identityAliases.some(alias => vTitleWording.includes(alias));

      const sRoot = semanticNorm(franchiseRoot);
      const sVideo = semanticNorm(videoTitle);
      const hasSemanticMatch = sRoot.length > 3 && sVideo.includes(sRoot);

      if (tokenRatio < 0.6 && !hasAliasMatch && !hasSemanticMatch) return null;

      const targetS = typeof identity.seasonNumber === "number" ? identity.seasonNumber : 1;
      const targetP = (typeof identity.part === "number" ? identity.part : 0) || (typeof identity.cour === "number" ? identity.cour : 0);
      const targetIsFinal = identity.finalSeason === true;

      let extractedS = parseNum(videoTitle, [/\bseason\s*(\d+)/i, /(\d+)(?:st|nd|rd|th)\s+season/i, /\btemporada\s*(\d+)/i, /(\d+)(?:ra|da|ta|ma)\s+temporada/i, /(\d+)\s+temporada/i, /([ivx]+)\s+season/i, /\bs(\d+)\b/i, /第\s*(\d+)\s*(?:期|シリーズ)/i]);
      if (!extractedS && franchiseRoot) {
        const rootPattern = wordingNormalize(franchiseRoot).trim().replace(/\s+/g, "\\s+");
        if (rootPattern) {
          const rootMatch = new RegExp(`(?:^|\\s)${rootPattern}\\s+(\\d+)\\b`, "i").exec(vTitleWording);
          if (rootMatch) extractedS = parseInt(rootMatch[1], 10);
        }
      }
      const vSeasonNum = extractedS;

      const vPartNum = parseNum(videoTitle, [/\bpart(?:e)?\s*(\d+)\b/i, /(\d+)(?:st|nd|rd|th)\s+part/i, /(\d+)(?:ra|da|ta|ma)\s+parte/i, /(\d+)\s+parte/i, /([ivx]+)\s+part/i, /第\s*(\d+)\s*部/i]);
      const vIsFinal = /\bfinal\s*season|temporada\s*final|kanketsu-hen|kanketsuhen/i.test(videoTitle);

      const videoP = vPartNum;
      const videoS = vSeasonNum || (videoP > 0 ? 1 : null);

      if (targetS > 1 || targetP > 0 || targetIsFinal) {
        if (videoS && videoS !== targetS) return null;
        if (videoP && videoP !== targetP) return null;
        if (vIsFinal !== targetIsFinal) return null;
        if (!videoS && !videoP && !vIsFinal) return null;
      } else {
        const isExplicitSequel = (videoS && videoS > 1) || vIsFinal || (videoP && videoP > 1) ||
          /\b(?:season\s*[2-9]|2nd\s*season|3rd\s*season|4th\s*season|s[2-9]|temporada\s*[2-9]|parte\s*[2-9]|part\s*[2-9]|cour\s*[2-9]|kanketsu)\b/i.test(videoTitle) ||
          /第\s*[2-9]\s*(?:期|シリーズ|部|クール)/.test(videoTitle);
        if (isExplicitSequel) return null;
      }

      const isRejected = REJECT_KEYWORDS.some(k => {
        const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
        return re.test(videoTitle) || re.test(videoDesc) || re.test(chNorm);
      });
      if (isRejected || videoTitle.includes("#short") || videoDesc.includes("#short") || videoTitle.includes("shorts") || videoDesc.includes("shorts")) return null;

      const hasDubMarker = /\b(?:doblaje|latino|español latino|sub español)\b/i.test(videoTitle);
      if (hasDubMarker && publisherType !== "REGIONAL" && publisherType !== "JP_ORIGINAL" && publisherType !== "ANIME_SPECIFIC" && !isVerified) return null;

      const hasEmoji = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(videoTitle);
      if (hasEmoji) return null;

      const hasTrailerMarker = officialMarkers.some(m => videoTitle.includes(m) || videoDesc.includes(m)) || /\b(?:pv|teaser|trailer|preview|avance|promo|announcement)\b/i.test(videoTitle);
      if (!hasTrailerMarker) return null;

      const engPatterns = ["watch now", "official trailer", "streaming", "only on", "coming soon", "available now"];
      const latamPatterns = ["ver en", "ya disponible", "mira el trailer", "subtitulado", "doblaje latino", "español latino", "netflix latinoamerica", "estreno", "tráiler oficial"];

      const isLatam = latamPatterns.some(p => videoTitle.includes(p) || videoDesc.includes(p))
        || chNorm.includes("espanol") || chNorm.includes("latino") || chNorm.includes("mexico") || chNorm.includes("latam");
      const isEnglish = (engPatterns.some(p => videoTitle.includes(p) || videoDesc.includes(p))
        || GLOBAL_EN_PUBLISHERS.some(p => chNorm === normalizeStr(p) || chNorm.startsWith(normalizeStr(p) + " ")))
        && !isLatam;

      if (isEnglish && !isLatam && publisherType !== "JP_ORIGINAL" && publisherType !== "ANIME_SPECIFIC") return null;

      if (isPreferredRegional) {
        const isEnglishMarker = /\b(?:english|eng sub|english dub|eng dub|sub english|official dub)\b/i.test(videoTitle);
        const isSpainMarker = /\b(?:castellano|españa|es-es)\b/i.test(videoTitle);
        if ((isEnglishMarker || isSpainMarker || (isEnglish && !isLatam)) && !chNorm.includes(normalizeStr(preferredChannel))) return null;
      }

      let score = 0;

      if (officialLinks.some(l => videoDesc.includes(l))) score += 100000000;
      if (officialMarkers.some(m => videoDesc.includes(m))) score += 50000000;

      if (publisherType === "REGIONAL") {
        score += 1000000000;
        if (preferredChannel && chNorm.includes(normalizeStr(preferredChannel))) score += 5000000000;
        if (isLatam && (videoTitle.includes("oficial") || videoTitle.includes("trailer"))) score += SUPER_PRIORITY;
        if (!isVerified) score -= 300000000;
      } else if (publisherType === "ANIME_SPECIFIC") {
        score += 800000000;
        if (preferredChannel && chNorm.includes(normalizeStr(preferredChannel))) score += 5000000000;
        if (!isVerified) score -= 100000000;
      } else if (publisherType === "JP_ORIGINAL") {
        score += 500000000;
        if (preferredChannel && chNorm.includes(normalizeStr(preferredChannel))) score += 5000000000;
        const REGION_LOCK_PRONE = ["nhk", "tv tokyo", "fuji tv", "tbs", "mbs", "yomiuri tv", "tms anime"];
        if (REGION_LOCK_PRONE.some(p => chNorm.includes(p))) score -= 2500000000;
        if (!isVerified) score -= 400000000;
      } else score -= 2000000000;

      if (isLatam) score += 500000000;

      if (publisherType === "REGIONAL" && isLatam && (videoTitle.includes("oficial") || videoDesc.includes("oficial"))) score += SUPER_PRIORITY;

      const isExactMetadata = vTitleNorm.includes(normalizeStr(romaji)) || vTitleNorm.includes(normalizeStr(english));
      if (isExactMetadata) score += 100000000;

      // Bonus por palabras clave de Arco/Identidad Única
      // Si estamos buscando un especial, el tráiler DEBE mencionarlo para tener prioridad absoluta.
      const arcKeywords = ["arc", "hen", "zenpen", "kouhen", "special", "especial", "ova", "oad", "shimetsu", "kaiyuu"];
      const qArcs = arcKeywords.filter(kw => wordingNormalize(romaji || english).includes(kw));
      if (qArcs.length > 0) {
        const matchCount = qArcs.filter(kw => vTitleWording.includes(kw)).length;
        if (matchCount > 0) {
          score += 5000000000; // Prioridad Crítica
        } else {
          score -= 3000000000; // Penalización por no mencionar el arco solicitado
        }
      }

      const isAd = /告知|告知動画|blu-ray|dvd|box|発売/i.test(videoTitle);

      if (/\b(?:main\s*pv|メインpv)\b/i.test(videoTitle)) score += 150000000;
      else if (/\b(?:pv|official\s*trailer|公式予告|本pv)\b/i.test(videoTitle)) score += 100000000;
      else if (/\b(?:teaser|teaser\s*pv|特報|ティザー)\b/i.test(videoTitle)) score += 50000000;
      else if (/\b(?:cm|commercial|tv\s*spot|公式cm)\b/i.test(videoTitle)) score -= 100000000;

      if (isAd && !hasTrailerMarker) score -= 1000000000;

      if (durationSec < MIN_DURATION_ACCEPT || durationSec > 360) return null;
      if (durationSec >= 60 && durationSec <= 180) score += 100000000;

      if (publisherType === "JP_ORIGINAL" || publisherType === "REGIONAL" || publisherType === "ANIME_SPECIFIC") {
        if (targetS > 1 || targetP > 1) {
          if (vSeasonNum === targetS || vPartNum === targetS) score += 200000000;
        } else if (targetS === 1 && (vSeasonNum === 1 || !vSeasonNum)) {
          score += 100000000;
        }
      }

      return { score, duration: durationSec, publisherType, isEnglish, isLatam, isVerified, hasTrailerMarker };
    };

    for (const q of searchQueries) {
      try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
        const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 4000 });
        const $ = cheerio.load(data);
        const script = $('script').filter((i, el) => ($(el).html() || "").includes('ytInitialData = ')).html();
        if (!script) continue;
        const json = JSON.parse(script.split('ytInitialData = ')[1].split('};')[0] + '}');
        const contents = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

        let foundHighQuality = false;

        for (const item of contents) {
          const v = item.videoRenderer;
          if (!v?.videoId) continue;
          const chName = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "";
          const result = scoreVideo(v);
          if (result) {
            allCandidates.push({
              id: v.videoId,
              score: result.score,
              channel: chName,
              duration: result.duration,
              publisherType: result.publisherType,
              isEnglish: result.isEnglish,
              isVerified: result.isVerified,
              isLatam: result.isLatam,
              hasTrailerMarker: result.hasTrailerMarker
            });

            // Si encontramos un candidato de un canal oficial verificado con buen score, salimos temprano
            if (result.score >= 1000000000 && result.isVerified) {
              foundHighQuality = true;
            }
          }
        }

        if (foundHighQuality) {
          console.log(`[Trailer] Early exit: Candidato oficial verificado encontrado para "${q}"`);
          break;
        }
      } catch {}
    }

    if (allCandidates.length === 0) return null;

    const regionalCandidateCount = allCandidates.filter(c =>
      c.publisherType === "REGIONAL" && c.isVerified && c.hasTrailerMarker && c.isLatam
    ).length;

    let disableRegionalSearch = false;
    let skipRegionalPriority = false;

    if (regionalCandidateCount === 0) {
      disableRegionalSearch = true;
      skipRegionalPriority = true;
    }

    let finalPool = [];

    if (!disableRegionalSearch && !skipRegionalPriority) {
      finalPool = allCandidates.filter(c => c.publisherType === "REGIONAL" && !c.isEnglish && c.isVerified);
      console.log(`[Trailer Search] Distribución Regional Oficial DETECTADA`);
    } else {
      console.log(`[Trailer Search] NO EXISTE REGIONAL REAL — Fallback a JP ORIGINAL`);
      const jpCandidates = allCandidates.filter(c => c.publisherType === "JP_ORIGINAL" || c.publisherType === "ANIME_SPECIFIC");

      if (jpCandidates.length > 0) {
        const strictJp = jpCandidates.filter(c => c.hasTrailerMarker && (c.isVerified || c.publisherType === "ANIME_SPECIFIC"));
        finalPool = strictJp.length > 0 ? strictJp : jpCandidates;
        console.log(`[Trailer Search] Saltando a JP ORIGINAL / ANIME SPECIFIC`);
      } else {
        finalPool = allCandidates.filter(c =>
          c.publisherType !== "GLOBAL_EN" && c.publisherType !== "REGIONAL" && !c.isLatam &&
          !c.channel.toLowerCase().includes("doblaje") && !c.channel.toLowerCase().includes("fandub")
        );
        console.log(`[Trailer Search] Fallback a FAN_UPLOAD`);
      }
    }

    let bestId = null, bestScore = -Infinity, bestChannel = null;
    for (const c of finalPool) {
      if (c.score > bestScore) {
        bestScore = c.score; bestId = c.id; bestChannel = c.channel;
      }
    }

    if (bestScore >= 5000000 && bestChannel) {
      const pType = getPublisherType(normalizeStr(bestChannel));
      const winner = finalPool.find(c => c.id === bestId);
      if ((pType === "REGIONAL" || pType === "JP_ORIGINAL") && winner?.isVerified) {
        preferredPublishers.set(franchiseKey, bestChannel);
        console.log(`[Trailer Franchise Publisher] Guardado: ${franchiseKey} -> ${bestChannel}`);
      }
    }

    return bestId;
  } catch (err) { return null; }
}

// ============================================================
//  MOVIE/SERIES TRAILER — getMovieTrailer
// ============================================================

async function getMovieTrailer(title, year = null, isMovie = true) {
  try {
    if (!title) return null;

    const overrideKey = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (TRAILER_OVERRIDES[overrideKey]) {
      console.log(`[MovieTrailer] OVERRIDE usado para "${title}"`);
      return TRAILER_OVERRIDES[overrideKey];
    }

    const getDurationSeconds = (text) => {
      if (!text) return 0;
      const parts = text.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };

    const REJECT_KEYWORDS = [
      "clip", "scene", "review", "analysis", "ending explained", "ending scene",
      "opening scene", "battle", "fight scene", "death scene", "best scene",
      "all scenes", "movie explained", "recap", "resumen", "review",
      "fandub", "fan dub", "fanmade", "fan-made", "unofficial", "parody",
      "parodia", "reaction", "reupload", "re-upload",
      "castellano", "españa", "spanish spain", "es-es",
      "shorts", "#short", "full movie", "pelicula completa", "movie online",
      "ver online", "descargar", "doblaje fan", "fan trailer", "concept trailer",
      "fan concept", "trailer made by", "edit", "amv", "mashup", "remix",
      "soundtrack", "ost", "score", "theme song", "music video", "cover",
      "what to expect", "news", "rumor", "confirmed", "release date",
      "cuando se estrena", "anuncio", "oficialmente", "ya hay fecha",
    ];

    const OFFICIAL_MOVIE_CHANNELS = [
      "warner bros", "wbpictures", "universal pictures", "paramount pictures",
      "disney", "pixar", "marvel entertainment", "marvel studios",
      "dc comics", "sony pictures", "sony pictures entertainment",
      "20th century studios", "20th century fox", "fox searchlight",
      "lionsgate movies", "lionsgate", "netflix", "prime video",
      "hbo", "hbo max", "hbo latinoamérica", "max latinoamérica",
      "apple tv", "apple tv+", "disney plus", "disney+ latinoamérica",
      "star+", "star plus latinoamérica", "paramount plus",
      "universal pictures latino", "warner bros latino", "warner bros latam",
      "sony pictures latinoamérica", "sony pictures latino", "sonypicturesméxico",
      "sony pictures méxico", "disney studios latinoamérica",
      "marvel latinoamérica", "marvel latino", "películas en español",
      "trailers en español", "tráilers oficiales", "beta entertainment",
      "casi creativo", "cine en español", "netflix latinoamérica",
      "prime video latinoamérica", "claro video", "claro video méxico",
      "a24", "blumhouse", "screen media", "bloody disgusting",
      "focus features", "searchlight pictures", "mgm", "metro goldwyn mayer",
      "columbia pictures", "triStar pictures", "dreamworks", "illumination",
      "legendary pictures", "village roadshow", "skydance", "new line cinema",
      "summit entertainment", "stx films", "open road films", "saban films",
      "vertical entertainment", "well go usa", "ifc films", "magnolia pictures",
      "shudder", "troma entertainment", "arrow films", "rlje films",
      "latino trailer", "trailers latinos", "trailers latam",
      "español latino", "películas latino", "cine latino",
      "mexico trailer", "trailers mexico", "trailers argentina",
      "trailers españa", "españa trailer", "tráilers españa",
      "sensacine", "ecartelera", "fotogramas", "cultura ocio",
      "movistar+", "filmin", "atresmedia", "antena 3",
      "telecinema", "medusa film", "deAPlaneta",
      "tráilers oficiales latino", "trailers oficiales latino",
    ];

    const LATAM_PUBLISHERS = [
      "netflix latinoamérica", "netflix latam", "netflix brasil",
      "prime video latinoamérica", "prime video latam",
      "hbo max latinoamérica", "hbo max latam", "max latinoamérica",
      "disney+ latinoamérica", "disney plus latino", "star+ latinoamérica",
      "claro video", "claro video méxico", "claro video colombia",
      "universal pictures latino", "warner bros latino", "warner bros latam",
      "sony pictures latinoamérica", "sony pictures latino", "sonypicturesméxico",
      "disney studios latinoamérica", "marvel latinoamérica",
      "venus films", "venus films ecuador",
    ];

    const getChannelType = (chName) => {
      const lower = chName.toLowerCase();
      if (LATAM_PUBLISHERS.some(c => lower.includes(c))) return "LATAM_PUBLISHER";
      if (OFFICIAL_MOVIE_CHANNELS.some(c => lower.includes(c))) return "OFFICIAL";
      if (lower.includes("trailer") || lower.includes("tráiler")) return "TRAILER_CHANNEL";
      if (lower.includes("cine") || lower.includes("movies") || lower.includes("film")) return "CINEMA_CHANNEL";
      if (/(español|latino|mexico|argentina|colombia|chile|peru)/i.test(lower)) return "LATAM_CHANNEL";
      return "UNKNOWN";
    };

    const titleHasSequelNumber = /\b(2|3|4|5|ii|iii|iv|part\s*\d+|parte\s*\d+)\b/i.test(title);
    const baseName = title.replace(/\s*[-–:]\s*.+$/g, "").replace(/\s*\d+\s*$/g, "").replace(/\s*(ii|iii|iv|part\s*\d+|parte\s*\d+)\s*$/gi, "").trim();

    const searchQueries = [];
    const yearStr = year ? ` ${year}` : "";

    if (year) {
      searchQueries.push(`${title}${yearStr} tráiler oficial`);
      searchQueries.push(`${title}${yearStr} trailer oficial`);
      searchQueries.push(`${title}${yearStr} official trailer`);
      searchQueries.push(`${title}${yearStr} tráiler`);
      searchQueries.push(`${title}${yearStr} teaser`);
    }

    searchQueries.push(`${title} tráiler oficial latino`);
    searchQueries.push(`${title} trailer oficial`);
    searchQueries.push(`${title} tráiler oficial`);
    searchQueries.push(`${title} official trailer`);

    if (baseName !== title) {
      if (year) searchQueries.push(`${baseName}${yearStr} trailer`);
      searchQueries.push(`${baseName} trailer`);
    }

    const LATAM_CHANNEL_QUERIES = [
      "Claro Video", "Claro Video México", "Prime Video Latinoamérica",
      "Netflix Latinoamérica", "Warner Bros Latino", "Sony Pictures Latino",
      "Disney Latinoamérica", "Star Plus Latino", "Trailers In Spanish",
      "Tráilers Oficiales", "Cine en Español",
      "Venus Films Ecuador", "Venus Films",
    ];
    for (const channel of LATAM_CHANNEL_QUERIES) {
      if (year) searchQueries.push(`${title}${yearStr} ${channel} trailer`);
      searchQueries.push(`${title} ${channel} trailer`);
    }

    const allCandidates = [];

    const scoreVideo = (v) => {
      const chName = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "";
      const chNorm = normalizeStr(chName);
      const channelType = getChannelType(chName);
      const videoTitle = (v.title?.runs?.[0]?.text || "").toLowerCase();
      const videoDesc = (v.descriptionSnippet?.runs?.map(r => r.text).join(" ") || "").toLowerCase();
      const vTitleNorm = normalizeStr(videoTitle);
      const durationSec = getDurationSeconds(v.lengthText?.simpleText || "");
      const isVerified = !!v.ownerBadges;

      const isRejected = REJECT_KEYWORDS.some(k => {
        const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
        return re.test(videoTitle) || re.test(videoDesc) || re.test(chNorm);
      });
      if (isRejected) return null;
      if (videoTitle.includes("#short") || videoDesc.includes("#short")) return null;
      if (videoTitle.includes("shorts") || videoDesc.includes("shorts")) return null;

      const titleTokens = normalizeStr(title).split(/\s+/).filter(t => t.length > 2);
      const matchedTokens = titleTokens.filter(t => vTitleNorm.includes(t));
      const tokenRatio = titleTokens.length > 0 ? matchedTokens.length / titleTokens.length : 0;
      if (tokenRatio < 0.8) return null;

      const sequelWords = /\b(return|returns|reboot|remake|regreso|2|3|4|5|ii|iii|iv)\b/i;
      const videoSequelWords = (videoTitle.match(sequelWords) || []).filter(Boolean);
      const titleSequelWords = (title.match(sequelWords) || []).filter(Boolean);
      if (videoSequelWords.length > 0 && titleSequelWords.length === 0) return null;
      if (videoSequelWords.length > 0 && titleSequelWords.length > 0) {
        const vNums = videoSequelWords.join(" ");
        const tNums = titleSequelWords.join(" ");
        if (!vNums.includes(tNums) && !tNums.includes(vNums)) return null;
      }

      const hasTrailerMarker = /trailer|tráiler|teaser|avance|preview|promo/i.test(videoTitle);
      if (!hasTrailerMarker) return null;

      if (durationSec < 15 || durationSec > 210) return null;

      let score = 0;

      if (channelType === "LATAM_PUBLISHER") {
        score += 2000000000;
        if (isVerified) score += 500000000;
      } else if (channelType === "OFFICIAL") {
        score += 1000000000;
        if (isVerified) score += 500000000;
      } else if (channelType === "TRAILER_CHANNEL") {
        score += 500000000;
      } else if (channelType === "CINEMA_CHANNEL") {
        score += 200000000;
      } else if (channelType === "LATAM_CHANNEL") {
        score += 300000000;
      } else {
        score -= 500000000;
      }

      const isSpain = /castellano|españa|spanish\s*spain|es-es/i.test(videoTitle) ||
        /castellano|españa/i.test(chNorm) ||
        /castellano|españa/i.test(videoDesc);
      if (isSpain) score -= 2000000000;

      const hasLatam = (/latino|español|méxico|mexico|argentina|colombia|chile|perú|venezuela/i.test(videoTitle) && !/castellano|españa/i.test(videoTitle)) ||
        /latam|espanol/i.test(chNorm) ||
        /tráiler\s*oficial/i.test(videoTitle);
      const isDubbed = (/(doblaje|audio\s*latino|español\s*latino|latino)/i.test(videoTitle) && !/subtitulado|sub\s*español/i.test(videoTitle)) ||
        (/(latino|doblaje)/i.test(videoDesc) && !/subtitulado|sub/i.test(videoDesc));
      if (hasLatam) {
        score += 1500000000;
        if (isDubbed) score += 1000000000;
      }

      if (/official|oficial|tráiler oficial|official trailer/i.test(videoTitle)) score += 300000000;

      if (year) {
        if (videoTitle.includes(String(year))) score += 500000000;
        if (new RegExp(`\\b${year}\\b`).test(videoTitle)) score += 300000000;
      }

      if (vTitleNorm.includes(normalizeStr(title))) score += 200000000;
      if (baseName !== title && vTitleNorm.includes(normalizeStr(baseName))) score += 100000000;

      if (durationSec >= 90 && durationSec <= 150) score += 500000000;
      else if (durationSec >= 60 && durationSec <= 89) score += 200000000;
      else if (durationSec >= 30 && durationSec <= 59) score += 50000000;

      if (/final\s+trailer/i.test(videoTitle)) score += 400000000;
      else if (/teaser/i.test(videoTitle)) score += 100000000;

      return { score, id: v.videoId, duration: durationSec, channel: chName, isVerified, channelType, hasLatam, isDubbed };
    };

    for (const q of searchQueries) {
      try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
        const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 4000 });
        const $ = cheerio.load(data);
        const script = $('script').filter((i, el) => ($(el).html() || "").includes('ytInitialData = ')).html();
        if (!script) continue;
        const json = JSON.parse(script.split('ytInitialData = ')[1].split('};')[0] + '}');
        const contents = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
        for (const item of contents) {
          const v = item.videoRenderer;
          if (!v?.videoId) continue;
          const result = scoreVideo(v);
          if (result) allCandidates.push(result);
        }
      } catch {}
    }

    if (!allCandidates.length) return null;

    allCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.isDubbed && !b.isDubbed) return -1;
      if (!a.isDubbed && b.isDubbed) return 1;
      return 0;
    });
    const best = allCandidates[0];

    if (!best.hasLatam && !best.isDubbed) {
      console.log(`[MovieTrailer] "${title}" → Sin LATAM, usando TMDB API como fallback`);
      return null;
    }

    console.log(`[MovieTrailer] "${title}" → id=${best.id} score=${best.score} channel="${best.channel}"${best.isDubbed ? " [DOBLAJE]" : ""}`);
    return best.id;
  } catch (err) {
    console.warn(`[MovieTrailer] Error: ${err.message}`);
    return null;
  }
}

// ============================================================
//  ANIME OP/ED THEME — getYoutubeOfficialTheme
// ============================================================

async function getYoutubeOfficialTheme(identity, type, maxThemes = 1, excludeIds = []) {
  try {
    if (typeof identity === 'string') {
      identity = { romaji: identity, english: null, native: null, synonyms: [] };
    }

    const isOP = type === 'Opening';
    const typeES = isOP ? 'opening' : 'ending';
    const typeJP = isOP ? 'OP' : 'ED';
    const noncreditJP = isOP ? 'ノンクレジットOP' : 'ノンクレジットED';

    const THEME_BLACKLIST = [
      "cover", "fan cover", "piano", "guitar", "drum", "bass", "violin",
      "karaoke", "nightcore", "8d", "slowed", "sped up", "amv", "edit",
      "remix", "fanmade", "instrumental", "reaction", "audio only",
      "弾いてみた", "arrangement", "vtuber", "fan animation"
    ];

    const ANIME_PUBLISHERS = [
      "toho animation", "aniplex", "kadokawa", "pony canyon", "fuji tv",
      "mbs", "tbs anime", "tv tokyo", "science saru", "mapa", "mappa",
      "shueisha", "netflix anime", "crunchyroll"
    ];

    const MUSIC_CHANNELS = [
      "sony music", "avex", "warner bros japan", "warner music", "universal music",
      "creepy nuts", "aimer", "yoasobi", "eve", "zutomayo"
    ];

    const MARKETING_BLACKLIST = [
      "collaboration music video", "special movie", "promotion video",
      "promotional video", "teaser", "trailer", "pv", "cm"
    ];

    const MUSIC_VIDEO_TERMS = [
      "music video", "official mv", "mv", "collaboration", "lyric video"
    ];

    const officialWhitelist = [
      ...ANIME_PUBLISHERS,
      ...MUSIC_CHANNELS,
      'lantis', 'muse asia', 'ani-one', 'flying dog', 'nippon columbia',
      'king records', 'j-aniplex', 'doga kobo', 'bones', 'madhouse',
      'bilibili', 'funimation', 'aniplus'
    ];
    if (identity.studios) {
      identity.studios.forEach(s => {
        const sl = s.toLowerCase();
        if (!officialWhitelist.includes(sl)) officialWhitelist.push(sl);
      });
    }

    const getDurationSeconds = (text) => {
      if (!text) return 0;
      const parts = text.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };

    const romaji = identity.romaji || '';
    const english = identity.english || '';
    const native = identity.native || '';
    const season = identity.season ? identity.season.toString() : null;
    const arcPart = romaji.includes(':') ? romaji.split(':')[1].trim() : null;

    const allTitles = [romaji, english, native, ...(identity.synonyms || [])]
      .filter(Boolean).map(t => t.toLowerCase());

    const buildQueries = (num) => {
      const n = num ? ` ${num}` : '';
      const nJP = num ? `${num}` : '';
      const qs = [];

      if (native) {
        qs.push(`TVアニメ『${native}』${noncreditJP}${nJP}`);
        qs.push(`${native} ${noncreditJP}${nJP}`);
      }
      if (romaji) {
        qs.push(`${romaji} ${typeJP}${n}`);
        qs.push(`${romaji} ${typeES}${n}`);
      }
      if (english) {
        qs.push(`${english} ${typeJP}${n}`);
        qs.push(`${english} ${typeES}${n}`);
      }
      return qs;
    };

    const searchYT = async (qText) => {
      try {
        const { data } = await axios.get(
          `https://www.youtube.com/results?search_query=${encodeURIComponent(qText)}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 5000 }
        );
        const $ = cheerio.load(data);
        const script = $('script').filter((i, el) => ($(el).html() || '').includes('ytInitialData = ')).html();
        if (!script) return [];
        const json = JSON.parse(script.split('ytInitialData = ')[1].split('};')[0] + '}');
        return json.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
      } catch { return []; }
    };

    const scoreVideo = (v) => {
      const channelName = (v.ownerText?.runs?.[0]?.text || '').toLowerCase();
      const videoTitle = (v.title?.runs?.[0]?.text || '').toLowerCase();
      const durationSec = getDurationSeconds(v.lengthText?.simpleText || '');

      const isBadCandidate = THEME_BLACKLIST.some(term => videoTitle.includes(term) || channelName.includes(term));
      if (isBadCandidate) return -5000;

      let score = 0;

      if (videoTitle.includes("ノンクレジットop")) score += 3000;
      if (videoTitle.includes("ノンクレジットed")) score += 3000;
      if (videoTitle.includes("ncop")) score += 2000;
      if (videoTitle.includes("nced")) score += 2000;

      const isOpeningVideo = (t) => t.includes("op") || t.includes("opening") || t.includes("ncop") || t.includes("ノンクレジットop") || t.includes("オープニング");
      const isEndingVideo = (t) => t.includes("ed") || t.includes("ending") || t.includes("nced") || t.includes("ノンクレジットed") || t.includes("エンディング");

      if (isOP && isOpeningVideo(videoTitle)) score += 1000;
      if (!isOP && isEndingVideo(videoTitle)) score += 1000;

      if (isOP && isEndingVideo(videoTitle)) score -= 300;
      if (!isOP && isOpeningVideo(videoTitle)) score -= 300;

      if (excludeIds.includes(v.videoId)) score -= 1000;

      if (/[ぁ-んァ-ン一-龯]/.test(videoTitle)) score += 500;

      if (ANIME_PUBLISHERS.some(c => channelName.includes(c))) score += 1200;
      else if (MUSIC_CHANNELS.some(c => channelName.includes(c))) score += 200;

      const isWhitelisted = officialWhitelist.some(c => channelName.includes(c));
      const isVerified = !!v.ownerBadges;
      if (isWhitelisted) score += 500;
      if (isVerified) score += 300;

      if (videoTitle.includes("creditless")) score += 600;
      if (videoTitle.includes("official") || videoTitle.includes("公式")) score += 400;

      if (MARKETING_BLACKLIST.some(term => videoTitle.includes(term))) score -= 200;
      if (MUSIC_VIDEO_TERMS.some(term => videoTitle.includes(term))) score -= 100;

      if (durationSec >= 60 && durationSec <= 100) score += 800;
      if (durationSec > 300) score -= 1000;

      let matchScore = 0;
      let exactAnimeMatch = false;
      for (const t of allTitles) {
        const tWords = t.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !['season', 'temporada', 'the', 'no', 'wo', 'wa', 'to', 'movie', 'pelicula', 'part', 'zenpen', 'hen'].includes(w));
        if (tWords.length > 0 && tWords.every(w => videoTitle.includes(w))) {
          matchScore = 1500;
          exactAnimeMatch = true;
          break;
        }
      }

      score += matchScore;
      if (!exactAnimeMatch) return -5000;

      const getSeasonNum = (str) => {
        const m = str.match(/(?:season|temporada|part|parte|s|第)\s*(\d+)\b/i) || str.match(/(\d+)(?:nd|rd|th|st)\s*(?:season|temp|part|cour)?/i);
        return m ? (m[1] || m[2]) : null;
      };

      const tSeason = getSeasonNum(romaji.toLowerCase()) || season;
      const vSeason = getSeasonNum(videoTitle);

      if (tSeason && tSeason !== "1") {
        if (!vSeason || vSeason !== tSeason) return -Infinity;
      } else if (vSeason && vSeason !== "1") {
        return -Infinity;
      }

      if (arcPart) {
        const arcWords = arcPart.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (arcWords.length > 0 && arcWords.every(w => videoTitle.includes(w))) score += 10000;
      }

      return score;
    };

    const candidates = new Map();

    const runQueries = async (qs) => {
      for (const q of qs) {
        const contents = await searchYT(q);
        for (const item of contents) {
          const v = item.videoRenderer;
          if (!v?.videoId || candidates.has(v.videoId)) continue;
          const sc = scoreVideo(v);
          if (sc > 0) candidates.set(v.videoId, { score: sc, url: `https://www.youtube.com/watch?v=${v.videoId}` });
        }
      }
    };

    await runQueries(buildQueries(1));
    if (candidates.size === 0) await runQueries(buildQueries(null));

    if (maxThemes >= 2) {
      await runQueries(buildQueries(2));
    }

    const sorted = [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxThemes)
      .map(c => c.url);

    return sorted;
  } catch { return []; }
}

module.exports = {
  getOfficialTrailer,
  getMovieTrailer,
  getYoutubeOfficialTheme,
  preferredPublishers,
};
