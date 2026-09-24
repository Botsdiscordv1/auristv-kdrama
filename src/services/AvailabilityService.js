const { SearchService } = require('./SearchService');
const { AniListProvider } = require('../providers/anilist/anilist.provider');

class AvailabilityService {
  constructor() {
    this.searchService = new SearchService();
    this.anilist = new AniListProvider();

    this.cache = new Map(); // key: animeId, value: { status, timestamp }
    this.aliasCache = new Map(); // key: originalTitle, value: { romaji, english }

    this.CACHE_TTL = 24 * 60 * 60 * 1000;
    this.validationQueue = [];
    this.isValidating = false;
  }

  _resolveKey(item) {
    if (item.id && item.id !== 0 && item.id !== '0') return String(item.id);
    const t = item.romaji || item.english || item.title || '';
    return `title:${t.toLowerCase().trim()}`;
  }

  async checkAvailability(item) {
    if (!item) return false;
    const id = this._resolveKey(item);
    const cached = this.cache.get(id);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.status === 'AVAILABLE';
    }
    this._enqueueValidation(item);
    return true;
  }

  async validateNow(item) {
    const id = this._resolveKey(item);
    const year = item.year;

    // 1. Primer intento con los títulos que ya tenemos
    let titles = this._extractTitles(item);
    let found = await this._trySearch(titles, { year });

    if (found) {
      this.cache.set(id, { status: 'AVAILABLE', timestamp: Date.now() });
      return true;
    }

    // 2. Si falló, buscamos alias en AniList (Capa de Inteligencia)
    console.log(`[Availability] 🤔 Título "${item.title}" no encontrado. Buscando alias en AniList...`);
    const alias = await this._resolveAliases(item.title);

    if (alias) {
      titles = [alias.romaji, alias.english, alias.native].filter(Boolean);
      found = await this._trySearch(titles, { year });
      if (found) {
        console.log(`[Availability] ✅ DESCUBIERTO: "${item.title}" disponible como "${found}"`);
        this.cache.set(id, { status: 'AVAILABLE', timestamp: Date.now() });
        return true;
      }
    }

    console.log(`[Availability] ❌ AGOTADO: "${item.title}" no existe en ninguna fuente.`);
    this.cache.set(id, { status: 'NOT_FOUND', timestamp: Date.now() });
    return false;
  }

  async _trySearch(titles, options = {}) {
    for (const title of titles) {
      if (!this._isSearchable(title)) continue;

      const searchQueries = [title];
      if (options.year) searchQueries.push(`${title} ${options.year}`);

      for (const q of searchQueries) {
        try {
          const results = await this.searchService.searchAllSources(q, 'anime');
          if (results && results.length > 0) return q;
        } catch (err) {
          console.error(`[Availability] Error en scraper para "${q}":`, err.message);
        }
      }
    }
    return null;
  }

  _isSearchable(text) {
    if (!text || text.length < 3) return false;

    // Filtro Profesional de Scripts No Latinos:
    // Exigimos que el título contenga al menos un bloque de caracteres alfanuméricos occidentales.
    // Esto descarta títulos que son 100% Kanji, Tailandés, Árabe, etc.
    const hasLatin = /[a-zA-Z0-9]/.test(text);

    if (!hasLatin) {
      console.log(`[Availability] 🛑 Ignorando búsqueda no-latina: "${text}"`);
      return false;
    }

    return true;
  }

  async _resolveAliases(originalTitle) {
    if (this.aliasCache.has(originalTitle)) return this.aliasCache.get(originalTitle);

    try {
      // Inteligencia: Si el título es largo y tiene separadores, probamos con la base
      // Ej: "Frieren: Beyond Journey's End" -> buscar alias para "Frieren"
      let searchTitle = originalTitle;
      if (originalTitle.includes(':') || originalTitle.includes('-')) {
        const parts = originalTitle.split(/[:\-]/);
        if (parts[0].trim().length > 3) {
          searchTitle = parts[0].trim();
          console.log(`[Availability] Buscando alias usando base: "${searchTitle}" (original: "${originalTitle}")`);
        }
      }

      // Si la base no es buscable (ej: es Kanji), no perdemos tiempo con la API
      if (!this._isSearchable(searchTitle)) return null;

      // Envolvemos en try-catch individual para evitar que un 404 rompa la cola de validación
      try {
        const detail = await this.anilist.getDetail(searchTitle);
        if (detail) {
          const data = { romaji: detail.romaji, english: detail.english, native: detail.native };
          this.aliasCache.set(originalTitle, data);
          return data;
        }
      } catch (err) {
        console.log(`[Availability] No se encontraron alias para "${searchTitle}" en AniList: ${err.message}`);
      }
    } catch (err) {
      console.error(`[Availability] Error resolviendo alias:`, err.message);
    }
    return null;
  }

  _enqueueValidation(item) {
    const id = this._resolveKey(item);
    if (this.cache.has(id) && (Date.now() - this.cache.get(id).timestamp < this.CACHE_TTL)) return;
    if (this.validationQueue.some(q => this._resolveKey(q) === id)) return;
    this.validationQueue.push(item);
    this._processQueue();
  }

  async _processQueue() {
    if (this.isValidating || this.validationQueue.length === 0) return;
    this.isValidating = true;

    try {
      while (this.validationQueue.length > 0) {
        const item = this.validationQueue.shift();
        try {
          await this._withTimeout(this.validateNow(item), 60000);
        } catch (err) {
          console.error(`[Availability] Error validando "${item && item.title}":`, err && err.message);
        }
        // Pacing Throttling: 2 segundos entre animes para proteger APIs y Scrapers
        await new Promise(r => setTimeout(r, 2000));
      }
    } finally {
      this.isValidating = false;
      // Si se encolaron más items durante el procesamiento, seguir
      if (this.validationQueue.length > 0) this._processQueue();
    }
  }

  async _withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timeout de validación (60s)')), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  _extractTitles(item) {
    const set = new Set();
    if (item.title) set.add(item.title);
    if (item.romaji) set.add(item.romaji);
    if (item.english) set.add(item.english);

    // Estrategia de Segmentación: añadir partes base de títulos largos (solo para series, no películas)
    const isMovie = (item.format || '').toUpperCase() === 'MOVIE';
    if (!isMovie) {
      const titles = [...set];
      for (const t of titles) {
        if (t.includes(':') || t.includes('-')) {
          const base = t.split(/[:\-]/)[0].trim();
          if (base.length > 3) set.add(base);
        }
      }
    }

    return [...set].filter(t => t.length > 2);
  }

  async warmUp(trendingItems) {
    console.log(`[Availability] Iniciando calentamiento con ${trendingItems.length} items...`);
    for (const item of trendingItems) {
      this._enqueueValidation(item);
    }
  }
}

module.exports = { AvailabilityService: new AvailabilityService() };
