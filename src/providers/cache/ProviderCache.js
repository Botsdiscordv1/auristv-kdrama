class CacheEntry {
  constructor(value, ttlMs) {
    this.value = value;
    this.expiresAt = Date.now() + ttlMs;
  }

  isValid() {
    return Date.now() < this.expiresAt;
  }
}

class ProviderCache {
  constructor(name, defaultTTLMs = 300000) {
    this._store = new Map();
    this._name = name;
    this._defaultTTL = defaultTTLMs;
  }

  _makeKey(parts) {
    return `${this._name}:${parts.join(':')}`;
  }

  get(parts) {
    const key = this._makeKey(parts);
    const entry = this._store.get(key);
    if (!entry || !entry.isValid()) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(parts, value, ttlMs) {
    const key = this._makeKey(parts);
    const ttl = ttlMs ?? this._defaultTTL;
    this._store.set(key, new CacheEntry(value, ttl));
  }

  clear() {
    this._store.clear();
  }

  delete(parts) {
    this._store.delete(this._makeKey(parts));
  }

  get size() {
    return this._store.size;
  }
}

module.exports = { ProviderCache };