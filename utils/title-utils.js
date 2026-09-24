function isGenericEpisodeName(name) {
  return !name || /^episodio\s*\d+$/i.test(name) || /^episode\s*\d+$/i.test(name) || !name.trim();
}

const splitSyl = (t) => t
  .replace(/(dai){2,}/gi, (m) => m.match(/dai/gi).join(" "))
  .replace(/(suk){2,}/gi, (m) => m.match(/suk/gi).join(" "));

function cleanTMDBTitle(title, seasonCleanRe) {
  return title
    ? title
        .replace(seasonCleanRe, "")
        .replace(/\s*\((?:TV|Movie|Film|dub|sub)\)\s*$/i, "")
        .trim()
    : title;
}

// Errores frecuentes de Google Translate en títulos cortos ES.
// Solo formas que son SIEMPRE incorrectas (sin ambigüedad de contexto):
// - tilde sobrante en llana (solá → sola)
// - tilde faltante en palabra que siempre la lleva (tambien → también)
// No incluir monosílabos ambiguos (si/sí, el/él, tu/tú, que/qué, esta/está).
const TITLE_ACCENT_FIXES = Object.freeze({
  // tilde sobrante (llana mal marcada como aguda)
  solá: 'sola',
  sóla: 'sola',
  // tilde faltante — invariantes en títulos
  tambien: 'también',
  despues: 'después',
  aqui: 'aquí',
  asi: 'así',
  dia: 'día',
  dias: 'días',
  pagina: 'página',
  paginas: 'páginas',
  musica: 'música',
  telefono: 'teléfono',
  telefonos: 'teléfonos',
  corazon: 'corazón',
  razon: 'razón',
  razones: 'razones',
  pelicula: 'película',
  peliculas: 'películas',
  numero: 'número',
  numeros: 'números',
  ultimo: 'último',
  ultima: 'última',
  ultimos: 'últimos',
  ultimas: 'últimas',
  unico: 'único',
  unica: 'única',
  unicos: 'únicos',
  unicas: 'únicas',
  proxima: 'próxima',
  proximo: 'próximo',
  proximas: 'próximas',
  proximos: 'próximos',
  facil: 'fácil',
  faciles: 'fáciles',
  dificil: 'difícil',
  dificiles: 'difíciles',
  publico: 'público',
  publica: 'pública',
  medico: 'médico',
  medica: 'médica',
  manana: 'mañana',
  mananas: 'mañanas',
  espanol: 'español',
  espanola: 'española',
  mas: 'más',
  ademas: 'además',
  anio: 'año',
  cancion: 'canción',
  canciones: 'canciones',
  pasion: 'pasión',
  pasiones: 'pasiones',
  avion: 'avión',
  aviones: 'aviones',
  jardin: 'jardín',
  arbol: 'árbol',
  arboles: 'árboles',
});

function _fixAccentsInWord(word) {
  if (!word) return word;
  const lower = word.toLowerCase();
  const fixed = TITLE_ACCENT_FIXES[lower];
  if (!fixed || fixed === lower) return word;
  if (word === word.toUpperCase() && word !== word.toLowerCase()) {
    return fixed.toUpperCase();
  }
  const first = word[0];
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return fixed[0].toUpperCase() + fixed.slice(1);
  }
  return fixed;
}

function _applyAccentFixes(text) {
  return text.replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, _fixAccentsInWord);
}

// Mayúscula inicial + corrección de tildes en títulos traducidos por máquina
// ("solá" → "Sola", "7. transparencia" → "7. Transparencia").
// Solo títulos, nunca sinopsis.
function polishTranslatedTitle(text) {
  if (!text || typeof text !== 'string') return text;
  let t = _applyAccentFixes(text.trim().replace(/\s+/g, ' '));
  const chars = [...t];
  const idx = chars.findIndex((ch) => /\p{L}/u.test(ch));
  if (idx < 0) return t;
  chars[idx] = chars[idx].toUpperCase();
  return chars.join('');
}

const CJK_RE = /[぀-ヿ一-鿿가-힯]/;

module.exports = {
  isGenericEpisodeName,
  splitSyl,
  cleanTMDBTitle,
  polishTranslatedTitle,
  CJK_RE,
};
