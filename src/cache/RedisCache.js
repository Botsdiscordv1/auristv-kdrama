const Redis = require('ioredis');

let redis = null;
let redisAvailable = false;

try {
  redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 1000);
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  redis.on('connect', () => { redisAvailable = true; });
  redis.on('error', () => { redisAvailable = false; });
  redis.on('close', () => { redisAvailable = false; });

  redis.connect().catch(() => { redisAvailable = false; });
} catch (e) {
  redisAvailable = false;
}

async function redisGet(key) {
  if (!redis || !redisAvailable) return null;
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function redisSet(key, value, ttlSeconds = 3600) {
  if (!redis || !redisAvailable) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {}
}

async function redisDel(key) {
  if (!redis || !redisAvailable) return;
  try { await redis.del(key); } catch {}
}

module.exports = { redis, redisGet, redisSet, redisDel, isRedisAvailable: () => redisAvailable };
