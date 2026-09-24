class IdentityResolver {
  constructor(anilistProvider) {
    this.anilist = anilistProvider;
  }

  _cleanTitle(title) {
    return (title || '')
      .replace(/\s*\((?:TV|Movie|Film|dub|sub)\)\s*$/i, '')
      .replace(/\s*[-–\s]*(?:\d+(?:st|nd|rd|th)?\s*(?:season|temporada|part|parte)|(?:season|temporada|part|parte)\s*\d+|II{1,3}|IV|V|VI{1,3}|final\s*season)\s*$/i, '')
      .trim();
  }

  async resolve(searchTitle, malId = null, metadataTitle = null, targetYear = null) {
    console.log(`[IdentityResolver] Resolviendo: "${searchTitle}" (Year: ${targetYear}, malId: ${malId}, metadataTitle: "${metadataTitle}")`);
    const cleanTitle = this._cleanTitle(searchTitle);
    const fallbackTitles = this._buildFallbackTitles(cleanTitle, searchTitle, metadataTitle);

    for (const attempt of fallbackTitles) {
      console.log(`[IdentityResolver] Intentando con: "${attempt}"`);
      const detail = await this._tryResolve(attempt, targetYear);
      if (detail) return detail;
    }

    console.log(`[IdentityResolver] ❌ No se pudo determinar la identidad de: "${searchTitle}"`);
    return null;
  }

  _buildFallbackTitles(cleanTitle, rawTitle, metadataTitle) {
    const seen = new Set();
    const titles = [];
    const add = (t) => { if (t && t.length > 2 && !seen.has(t)) { seen.add(t); titles.push(t); return true; } return false; };
    add(cleanTitle);                        // 1. Clean title (original)
    if (rawTitle !== cleanTitle) add(rawTitle); // 2. Raw title if different

    // 3. MetadaTitle if different
    if (metadataTitle && metadataTitle !== cleanTitle && metadataTitle !== rawTitle) {
      add(this._cleanTitle(metadataTitle));
    }

    // 4. Base segmentada (split por : o -)
    const splitOn = [':', '-', '–'];
    for (const sep of splitOn) {
      if (cleanTitle.includes(sep)) {
        const base = cleanTitle.split(sep)[0].trim();
        if (base.length > 3) add(base);
      }
    }

    // 5. Versión con caracteres repetidos expandidos (romaji japonés)
    //    "daidaidaidaidaisuki" → "dai dai dai dai daisuki"
    const expanded = this._expandRepeatedChars(cleanTitle);
    if (expanded !== cleanTitle) add(expanded);
    if (metadataTitle) {
      const expandedMeta = this._expandRepeatedChars(this._cleanTitle(metadataTitle));
      if (expandedMeta !== metadataTitle && expandedMeta !== cleanTitle) add(expandedMeta);
    }

    // 6. Términos clave: extraer posibles identificadores únicos
    const fragments = this._extractKeyTerms(cleanTitle);
    for (const f of fragments) add(f);
    if (metadataTitle) {
      const metaFragments = this._extractKeyTerms(this._cleanTitle(metadataTitle));
      for (const f of metaFragments) add(f);
    }

    return titles;
  }

  _expandRepeatedChars(str) {
    return str.replace(/\b([a-zà-ÿ]{2,6}?)\1{2,}[a-zà-ÿ]*\b/gi, (match) => {
      const lower = match.toLowerCase();
      for (let unitLen = 2; unitLen <= 6; unitLen++) {
        const unit = lower.substring(0, unitLen);
        let i = unitLen;
        while (i + unitLen <= lower.length && lower.substring(i, i + unitLen) === unit) i += unitLen;
        if (i > unitLen * 2) {
          const rest = lower.substring(i);
          const totalReps = i / unitLen;
          if (rest.startsWith(unit)) {
            return Array(totalReps + 1).fill(unit).join(' ') + rest.substring(unit.length);
          }
          return Array(totalReps).fill(unit).join(' ') + ' ' + rest;
        }
      }
      return match;
    });
  }

  _extractKeyTerms(str) {
    const results = [];
    const lower = str.toLowerCase();

    // Extraer términos con números (ej: "100-nin", "2nd")
    const numTerms = lower.match(/[a-z]*\d+[a-z-]*[a-z]+|[a-z]+-\d+/gi);
    if (numTerms) {
      for (const t of numTerms) {
        results.push(t);
        // También probar el término sin números de temporada (ej: "100-nin no kanojo")
        const seasonRemoved = t.replace(/[- ]\d+(st|nd|rd|th)?/i, '').trim();
        if (seasonRemoved.length > 3 && seasonRemoved !== t) results.push(seasonRemoved);
      }
    }

    // Extraer palabras japonesas únicas (términos que no son artículos/preposiciones)
    const uniqueWords = lower.split(/[\s-]+/).filter(w =>
      w.length > 3 && !['para', 'with', 'that', 'this', 'from', 'koto', 'daisuki'].includes(w)
    );
    if (uniqueWords.length > 2) {
      // Probar combinaciones de las últimas 2-3 palabras significativas
      for (let i = Math.max(0, uniqueWords.length - 3); i < uniqueWords.length; i++) {
        const combo = uniqueWords.slice(i).join(' ');
        if (combo.length > 5) results.push(combo);
      }
      // Probar primeras 2 palabras si son únicas
      if (uniqueWords.length >= 2) {
        const firstTwo = uniqueWords.slice(0, 2).join(' ');
        if (firstTwo.length > 4) results.push(firstTwo);
      }
    }

    return results;
  }

  async _tryResolve(title, targetYear) {
    // Paso A: Intento directo
    try {
      const detail = await this.anilist.getDetail(title, targetYear);
      if (detail && this._validateMatch(title, detail, targetYear)) return detail;
    } catch {}

    // Paso B: Intento segmentado (base antes de : o -)
    if (title.includes(':') || title.includes('-')) {
      const base = title.split(/[:\-]/)[0].trim();
      if (base.length > 3) {
        try {
          const detail = await this.anilist.getDetail(base, targetYear);
          if (detail && this._validateMatch(title, detail, targetYear)) return detail;
        } catch {}
      }
    }

    // Paso C: Búsqueda broad
    try {
      const results = await this.anilist.search(title, 1, targetYear);
      if (results && results.length > 0) {
        const candidate = await this.anilist.getById(results[0].id);
        if (candidate && this._validateMatch(title, candidate, targetYear)) return candidate;
      }
    } catch {}

    return null;
  }

  _validateMatch(originalTitle, candidate, targetYear) {
    if (!candidate) return false;

    // 1. Validación por Año (Prioridad Alta)
    // Si tenemos un año objetivo, debe coincidir con un margen de +/- 1 año
    if (targetYear && candidate.year) {
      const diff = Math.abs(parseInt(targetYear) - parseInt(candidate.year));
      if (diff > 1) {
        console.log(`[IdentityResolver] Rechazado por año: "${candidate.title}" (${candidate.year}) vs Esperado (${targetYear})`);
        return false;
      }
    }

    // 2. Validación por Nombre (Scoring de palabras)
    const norm = (s) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
    const targetNorm = norm(this._cleanTitle(originalTitle));
    const candidateTitles = [
      norm(candidate.title),
      norm(candidate.romaji),
      norm(candidate.english),
      ...(candidate.synonyms || []).map(norm)
    ];

    const isMatch = candidateTitles.some(t => {
      if (!t) return false;
      // Coincidencia exacta o contenida significativa
      return t === targetNorm || t.includes(targetNorm) || targetNorm.includes(t);
    });

    if (!isMatch) {
      console.log(`[IdentityResolver] Rechazado por nombre: "${candidate.title}" no coincide con "${originalTitle}"`);
    }

    return isMatch;
  }

  async search(query, page = 1) {
    try {
      const results = await this.anilist.search(query, page);
      return results || [];
    } catch { return []; }
  }

  async getTrending(season, year) {
    try {
      const results = await this.anilist.getTrending(season, year);
      return results || [];
    } catch { return []; }
  }

  async getTrendingMovies() {
    try {
      const results = await this.anilist.getTrendingMovies();
      return results || [];
    } catch { return []; }
  }

  getCurrentSeason() {
    const m = new Date().getMonth() + 1;
    if (m <= 3) return 'WINTER';
    if (m <= 6) return 'SPRING';
    if (m <= 9) return 'SUMMER';
    return 'FALL';
  }
}

module.exports = { IdentityResolver };
