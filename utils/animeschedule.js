const axios = require('axios');

const BASE_URL = 'https://animeschedule.net/api/v3';
const IMG_BASE = 'https://img.animeschedule.net/production/assets/public/img/';

function getHeaders() {
  return { 'Authorization': `Bearer ${process.env.ANIMESCHEDULE_API_KEY}` };
}

async function fetchTimetables(airType = 'sub') {
  const { data } = await axios.get(`${BASE_URL}/timetables/${airType}`, {
    headers: getHeaders(),
    timeout: 10000,
  });
  return data;
}

async function fetchAnimeByRoute(route) {
  const { data } = await axios.get(`${BASE_URL}/anime/${route}`, {
    headers: getHeaders(),
    timeout: 10000,
  });
  return data;
}

function buildImageUrl(imageRoute) {
  if (!imageRoute) return null;
  return `${IMG_BASE}${imageRoute}`;
}

module.exports = { fetchTimetables, fetchAnimeByRoute, buildImageUrl };
