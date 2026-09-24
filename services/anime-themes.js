/**
 * services/anime-themes.js
 * Fetches OP/ED themes from AnimeThemes.moe API.
 */

const axios = require("axios");

const themeCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function createAnimeThemesSlug(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

async function fetchAnimeThemes(identity, malId) {
  const romaji = identity.romaji || "";
  const english = identity.english || "";

  if (identity.format) {
    const fmt = String(identity.format).toUpperCase().trim();
    const skipFormats = ["SPECIAL", "OVA", "PV", "CM", "MUSIC"];
    if (skipFormats.includes(fmt)) {
      console.log(`[AnimeThemes] skipped "${romaji}" type=${fmt}`);
      return null;
    }
  }

  const cacheKey = malId ? `at:id:${malId}` : `at:slug:${createAnimeThemesSlug(romaji)}`;

  if (themeCache.has(cacheKey)) {
    const entry = themeCache.get(cacheKey);
    if (Date.now() - entry.time < CACHE_TTL) {
      console.log(`[AnimeThemes] cache HIT`);
      return entry.data;
    }
  }

  try {
    let anime = null;

    if (malId) {
      const url = `https://api.animethemes.moe/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]=${malId}&include=animethemes.animethemeentries.videos,animethemes.song,animethemes.song.artists,images`;
      const res = await axios.get(url, { timeout: 5000 }).catch((e) => {
        console.error(`[AnimeThemes] API Error (ID): ${e.message}`);
        return null;
      });
      if (res?.data?.anime?.length) {
        anime = res.data.anime[0];
        console.log(`[AnimeThemes] ID match found: "${anime.name}"`);
      }
    }

    if (!anime) {
      const slugs = [...new Set([
        createAnimeThemesSlug(romaji),
        createAnimeThemesSlug(english),
        createAnimeThemesSlug(identity.native)
      ])].filter(Boolean);

      for (const slug of slugs) {
        const url = `https://api.animethemes.moe/anime/${slug}?include=animethemes.animethemeentries.videos,animethemes.song,animethemes.song.artists,images`;
        const res = await axios.get(url, { timeout: 4000 }).catch((e) => {
          console.error(`[AnimeThemes] API Error (Slug ${slug}): ${e.message}`);
          return null;
        });
        if (res?.data?.anime) {
          anime = res.data.anime;
          console.log(`[AnimeThemes] slug match found: "${slug}"`);
          break;
        }
      }
    }

    if (!anime) {
      console.log(`[AnimeThemes] no themes found (slugs failed)`);
      return null;
    }

    const openings = [];
    const endings = [];

    // Buscamos específicamente un banner en las imágenes del anime para máxima calidad
    const animeBanner = anime.images?.find(img => img.facet === "banner")?.link;

    anime.animethemes?.forEach(theme => {
      const entry = theme.animethemeentries?.[0];
      const video = entry?.videos?.[0];
      const videoUrl = video?.link;
      // Usamos el banner oficial de AnimeThemes si existe
      const imageUrl = animeBanner;

      if (videoUrl) {
        const rawType = String(theme.type || "").toUpperCase().trim();
        const isOP = rawType.startsWith("OP") || rawType === "OPENING";
        const isED = rawType.startsWith("ED") || rawType === "ENDING";

        const themeData = {
          title: theme.song?.title || "Unknown",
          artist: theme.song?.artists?.map(a => a.name).join(", ") || "Unknown",
          video: videoUrl,
          image: imageUrl || null,
          type: isOP ? "OP" : "ED",
          sequence: theme.sequence || 1,
          version: entry.version || "Original",
          source: "AnimeThemes"
        };

        if (isOP) openings.push(themeData);
        else if (isED) endings.push(themeData);
      }
    });

    const result = { op: openings, ed: endings };
    themeCache.set(cacheKey, { data: result, time: Date.now() });
    console.log(`[AnimeThemes] total themes found: ${openings.length + endings.length} (OP=${openings.length}, ED=${endings.length})`);
    return result;
  } catch (err) {
    console.error("[AnimeThemes] Error:", err.message);
    return null;
  }
}

module.exports = { fetchAnimeThemes, createAnimeThemesSlug, themeCache };
