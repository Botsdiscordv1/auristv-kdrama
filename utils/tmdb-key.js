const rawKeys = process.env.TMDB_API_KEYS || process.env.TMDB_API_KEY || '';
const keys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
if (keys.length === 0) {
  console.warn('[TMDB] No API keys configured. Set TMDB_API_KEY or TMDB_API_KEYS.');
}

let idx = 0;

function getKey() {
  if (keys.length === 0) return null;
  if (keys.length === 1) return keys[0];
  const key = keys[idx];
  idx = (idx + 1) % keys.length;
  return key;
}

module.exports = { getKey };
