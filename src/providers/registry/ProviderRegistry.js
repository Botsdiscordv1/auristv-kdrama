const { AniListProvider } = require('../anilist/anilist.provider');
const { TMDBProvider } = require('../tmdb/tmdb.provider');
const { JikanProvider } = require('../jikan/jikan.provider');
const { AnimeScheduleProvider } = require('../animeSchedule/animeSchedule.provider');
const { AnimeThemesProvider } = require('../animeThemes/animeThemes.provider');
const { AnimeAV1Provider } = require('../animeav1/animeav1.provider');
const { AnimeFLVProvider } = require('../animeflv/animeflv.provider');
const { JKAnimeProvider } = require('../jkanime/jkanime.provider');
const { AniyaeProvider } = require('../aniyae/aniyae.provider');

const DEFAULT_PRIORITIES = {
  identity: ['AniList'],
  searchMetadata: ['AniList'],
  relations: ['AniList'],
  recommendations: ['AniList'],
  visuals: ['TMDB', 'AniList'],
  episodeMetadata: ['TMDB'],
  themes: ['AnimeThemes'],
  schedule: ['AnimeSchedule', 'AniList'],
  characters: ['Jikan', 'AniList'],
  staff: ['Jikan'],
  search: ['AnimeAV1', 'AnimeFLV', 'JKAnime', 'Aniyae'],
  episodes: ['AnimeAV1', 'AnimeFLV', 'JKAnime', 'Aniyae'],
  streams: ['AnimeAV1', 'AnimeFLV', 'JKAnime', 'Aniyae'],
};

const PROVIDER_DEFS = [
  { name: 'AniList', type: 'metadata', Class: AniListProvider, capabilities: ['identity', 'searchMetadata', 'relations', 'recommendations', 'visuals', 'schedule', 'characters'] },
  { name: 'TMDB', type: 'metadata', Class: TMDBProvider, capabilities: ['visuals', 'episodeMetadata'] },
  { name: 'Jikan', type: 'metadata', Class: JikanProvider, capabilities: ['characters', 'staff'] },
  { name: 'AnimeSchedule', type: 'metadata', Class: AnimeScheduleProvider, capabilities: ['schedule'] },
  { name: 'AnimeThemes', type: 'metadata', Class: AnimeThemesProvider, capabilities: ['themes'] },
  { name: 'AnimeAV1', type: 'content', Class: AnimeAV1Provider, capabilities: ['search', 'episodes', 'streams'] },
  { name: 'AnimeFLV', type: 'content', Class: AnimeFLVProvider, capabilities: ['search', 'episodes', 'streams'] },
  { name: 'JKAnime', type: 'content', Class: JKAnimeProvider, capabilities: ['search', 'episodes', 'streams'] },
  { name: 'Aniyae', type: 'content', Class: AniyaeProvider, capabilities: ['search', 'episodes', 'streams'] },
];

const HEALTH_INTERVAL = 300000;

class ProviderRegistry {
  constructor() {
    this._providers = new Map();
    this._byType = { metadata: [], content: [] };
    this._byCapability = {};
    this._priorities = {};
    this._states = {};
    this._stats = {};
    this._enabled = {};
    this._healthTimer = null;
    this._initialized = false;

    for (const { name, type, Class, capabilities } of PROVIDER_DEFS) {
      const instance = new Class();
      this._providers.set(name, { instance, type, name, capabilities });
      this._byType[type].push(instance);
      this._enabled[name] = true;
      this._states[name] = { status: 'OFFLINE', responseTime: null, lastSuccess: null, lastFailure: null };
      this._stats[name] = { requests: 0, successes: 0, failures: 0, timeouts: 0, rateLimits: 0, cacheHits: 0, cacheMisses: 0, totalTime: 0 };

      for (const cap of capabilities) {
        if (!this._byCapability[cap]) this._byCapability[cap] = [];
        this._byCapability[cap].push(instance);
      }
    }

    this._priorities = { ...DEFAULT_PRIORITIES };
  }

  get(name) {
    const entry = this._providers.get(name);
    return entry ? entry.instance : null;
  }

  getAllByType(type) {
    return this._byType[type] || [];
  }

  get metadata() {
    return this._byType.metadata;
  }

  get content() {
    return this._byType.content;
  }

  get all() {
    return [...this._providers.values()].map(e => e.instance);
  }

  names() {
    return [...this._providers.keys()];
  }

  getByCapability(capability) {
    const providers = this._byCapability[capability];
    if (!providers || providers.length === 0) return [];
    const priority = this._priorities[capability] || [];
    const sorted = [...providers].sort((a, b) => {
      const ai = priority.indexOf(a.name);
      const bi = priority.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    return sorted;
  }

  getFirstAvailable(capability) {
    const providers = this.getByCapability(capability);
    for (const p of providers) {
      if (this.isEnabled(p.name) && this._states[p.name]?.status === 'ONLINE') {
        return p;
      }
    }
    for (const p of providers) {
      if (this.isEnabled(p.name)) return p;
    }
    return null;
  }

  setPriority(capability, order) {
    if (order && order.length > 0) {
      this._priorities[capability] = order;
    }
  }

  setEnabled(name, enabled) {
    if (this._providers.has(name)) {
      this._enabled[name] = enabled;
      if (!enabled) this._states[name].status = 'DISABLED';
      else this._states[name].status = 'ONLINE';
    }
  }

  isEnabled(name) {
    return this._enabled[name] !== false;
  }

  getState(name) {
    return this._states[name] || null;
  }

  getAllStates() {
    return { ...this._states };
  }

  getStats(name) {
    return this._stats[name] || null;
  }

  getAllStats() {
    return { ...this._stats };
  }

  recordSuccess(name, timeMs) {
    if (!this._stats[name]) return;
    this._stats[name].requests++;
    this._stats[name].successes++;
    this._stats[name].totalTime += timeMs;
    this._states[name].status = 'ONLINE';
    this._states[name].lastSuccess = new Date().toISOString();
    this._states[name].responseTime = timeMs;
  }

  recordFailure(name, error) {
    if (!this._stats[name]) return;
    this._stats[name].requests++;
    this._stats[name].failures++;
    this._stats[name].totalTime += 0;
    this._states[name].lastFailure = new Date().toISOString();
    if (error?.code === 'PROVIDER_TIMEOUT') {
      this._stats[name].timeouts++;
      this._states[name].status = 'DEGRADED';
    } else if (error?.code === 'PROVIDER_RATE_LIMIT') {
      this._stats[name].rateLimits++;
      this._states[name].status = 'RATE_LIMITED';
    } else {
      this._states[name].status = 'DEGRADED';
    }
  }

  async initializeAll() {
    for (const [name, { instance }] of this._providers) {
      if (!this._enabled[name]) continue;
      try {
        await instance.initialize();
        this._states[name].status = 'ONLINE';
      } catch (err) {
        console.error(`[ProviderRegistry] Failed to initialize ${name}: ${err.message}`);
        this._states[name].status = 'OFFLINE';
        this._stats[name].failures++;
      }
    }
    this._initialized = true;
    this._startHealthMonitor();
  }

  async healthAll() {
    const results = {};
    for (const [name, { instance }] of this._providers) {
      if (!this._enabled[name]) {
        results[name] = { name, status: 'DISABLED', type: this._providers.get(name)?.type };
        continue;
      }
      try {
        const h = await instance.health();
        results[name] = h;
        this._states[name] = {
          status: h.status,
          responseTime: h.responseTime,
          lastSuccess: h.lastSuccess || this._states[name].lastSuccess,
          lastFailure: h.lastFailure || this._states[name].lastFailure,
        };
      } catch (err) {
        results[name] = { name, status: 'ERROR', error: err.message };
        this._states[name].status = 'OFFLINE';
        this._states[name].lastFailure = new Date().toISOString();
      }
    }
    return results;
  }

  async closeAll() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    for (const { instance } of this._providers.values()) {
      try {
        await instance.close();
      } catch (err) {
        console.error(`[ProviderRegistry] Failed to close ${instance.name}: ${err.message}`);
      }
    }
    this._initialized = false;
  }

  _startHealthMonitor() {
    if (this._healthTimer) clearInterval(this._healthTimer);
    this._healthTimer = setInterval(() => {
      this.healthAll().catch(err => console.error('[ProviderRegistry] Health monitor error:', err.message));
    }, HEALTH_INTERVAL);
    this._healthTimer.unref();
  }
}

const registry = new ProviderRegistry();

module.exports = { registry, ProviderRegistry };