const { getKey } = require('./tmdb-key');

module.exports = {
  getTMDBKey: getKey,
  get TMDB_API_KEY() { return getKey(); },
  OMDB_API_KEY: process.env.OMDB_API_KEY || null,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  TMDB_POSTER: (path) => path ? `https://image.tmdb.org/t/p/w500${path}` : null,
  TMDB_BACKDROP: (path) => path ? `https://image.tmdb.org/t/p/w1280${path}` : null,
};
