const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "subscriptions.json");

let data = null;

function loadData() {
  if (data) return data;
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } else {
      data = { users: {} };
    }
  } catch {
    data = { users: {} };
  }
  return data;
}

function saveData() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[Notifications] Error saving:", err.message);
  }
}

function getSubscriptions(userId) {
  loadData();
  if (!data.users[userId]) {
    data.users[userId] = { animes: [] };
  }
  return data.users[userId].animes;
}

function addSubscription(userId, anime) {
  loadData();
  if (!data.users[userId]) data.users[userId] = { animes: [] };
  const exists = data.users[userId].animes.find(a => a.url === anime.url);
  if (exists) return false;
  data.users[userId].animes.push({
    title: anime.title,
    url: anime.url,
    source: anime.source,
    lastEpisode: anime.lastEpisode || 0,
    addedAt: new Date().toISOString(),
  });
  saveData();
  return true;
}

function removeSubscription(userId, url) {
  loadData();
  if (!data.users[userId]) return false;
  const len = data.users[userId].animes.length;
  data.users[userId].animes = data.users[userId].animes.filter(a => a.url !== url);
  if (data.users[userId].animes.length !== len) {
    saveData();
    return true;
  }
  return false;
}

function listAll() {
  loadData();
  return data.users;
}

module.exports = {
  loadData,
  saveData,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  listAll,
};
