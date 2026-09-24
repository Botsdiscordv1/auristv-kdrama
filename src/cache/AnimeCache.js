class AnimeCache {
  constructor(ttl = 60 * 60 * 1000, maxSize = 200) {
    this._store = new Map();
    this._ttl = ttl;
    this._maxSize = maxSize;
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._ttl) {
      this._store.delete(key);
      return null;
    }
    return entry.val;
  }

  set(key, val) {
    if (this._store.size >= this._maxSize) {
      const oldest = this._store.keys().next().value;
      if (oldest) this._store.delete(oldest);
    }
    this._store.set(key, { val, ts: Date.now() });
  }

  clear() {
    this._store.clear();
  }

  get size() {
    return this._store.size;
  }
}

class ScheduleCache {
  constructor(ttl = 60 * 60 * 1000) {
    this._val = null;
    this._ts = 0;
    this._ttl = ttl;
  }

  get() {
    if (this._val && Date.now() - this._ts < this._ttl) return this._val;
    return null;
  }

  set(val) {
    this._val = val;
    this._ts = Date.now();
  }

  invalidate() {
    this._val = null;
    this._ts = 0;
  }
}

module.exports = { AnimeCache, ScheduleCache };
