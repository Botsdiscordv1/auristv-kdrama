/**
 * utils/anilist-queue.js
 * Helper para consultas a AniList con retry en 429.
 * SIN queue global — cada llamada es directa con retry opcional.
 */

const axios = require("axios");

async function anilistQuery(query, variables, timeout = 8000, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await axios.post("https://graphql.anilist.co",
        { query, variables },
        { timeout }
      );
      return resp;
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
        console.warn(`[AniList] 429, retrying in ${Math.round(delay)}ms (${attempt}/${retries - 1})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

module.exports = { anilistQuery };
