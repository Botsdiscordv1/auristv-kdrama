const axios = require('axios');

const client = axios.create({
  baseURL: 'https://graphql.anilist.co',
  timeout: 8000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

async function query(queryStr, variables, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await client.post('', { query: queryStr, variables });
      return data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

module.exports = { client, query };
