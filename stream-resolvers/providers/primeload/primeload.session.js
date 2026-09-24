'use strict';

const crypto = require('crypto');
const axios = require('axios');
const {
  PRIMELOAD_HOST_RE,
  PRIMELOAD_CDN_HOST_RE,
  PRIMELOAD_API_TIMEOUT_MS,
  PRIMELOAD_AUTH_TIMEOUT_MS,
  PRIMELOAD_WS_TIMEOUT_MS,
  PRIMELOAD_SESSION_TTL_MS,
  PRIMELOAD_USER_AGENT,
} = require('./primeload.constants');

const WEBGL_RENDERER =
  'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)';
const AUDIO_FINGERPRINT = 0.04354095458984375;
const FORGED_CANVAS_SEED = 'StreamFi-fp-v1|18px Arial';

const sessionsByKey = new Map();
const initInFlight = new Map();

function sha256hex(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function forgeFingerprint() {
  const canvas = sha256hex(`forged-canvas:${FORGED_CANVAS_SEED}`);
  return sha256hex(`${canvas}|${WEBGL_RENDERER}|${AUDIO_FINGERPRINT}`);
}

function forgeResponses(tasks) {
  return (tasks || []).map((task) => {
    switch (task && task.type) {
      case 'canvas_text':
        return sha256hex(`forged-canvas:${task.text}:${task.font}`);
      case 'webgl_renderer':
        return WEBGL_RENDERER;
      case 'audio_fingerprint':
        return AUDIO_FINGERPRINT;
      case 'dom_measurement': {
        const w = /width:\s*([\d.]+)px/.exec(task.style || '');
        const h = /height:\s*([\d.]+)px/.exec(task.style || '');
        return {
          w: w ? parseFloat(w[1]) : 100,
          h: h ? parseFloat(h[1]) : 100,
        };
      }
      case 'timing': {
        const t0 = process.hrtime.bigint();
        let acc = 0;
        for (let i = 0; i < 1e5; i++) acc += Math.sqrt(i);
        return Math.round((Number(process.hrtime.bigint() - t0) / 1e6) * 100) / 100;
      }
      default:
        return null;
    }
  });
}

function parseCookies(setCookieHeaders) {
  const jar = new Map();
  const list = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  for (const raw of list) {
    const first = String(raw).split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function xsrfFromJar(jar) {
  const raw = jar.get('XSRF-TOKEN');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function decodeHtmlAttr(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractPlayerAttrs(html) {
  const attrs = {};
  for (const m of String(html || '').matchAll(/data-([a-zA-Z-]+)="([^"]*)"/g)) {
    attrs[m[1]] = m[2];
  }
  let challenge = null;
  try {
    if (attrs.challenge) challenge = JSON.parse(decodeHtmlAttr(attrs.challenge));
  } catch {
    challenge = null;
  }
  return {
    token: attrs.token || null,
    api: attrs.api || 'https://primeload.co/api/v1',
    session: attrs.session || null,
    challenge,
    socket: attrs.socket || 'https://primeload.co',
    nonce: attrs.nonce || null,
    poster: attrs.poster || null,
  };
}

function sessionKeyFromCdnUrl(cdnUrl) {
  try {
    const u = new URL(cdnUrl);
    if (!PRIMELOAD_CDN_HOST_RE.test(u.hostname)) return null;
    // /stream/hls/{contentId}/{videoId}/...
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('hls');
    if (idx >= 0 && parts[idx + 1] && parts[idx + 2]) {
      return `${parts[idx + 1]}/${parts[idx + 2]}`;
    }
    return u.pathname;
  } catch {
    return null;
  }
}

function parseSegmentPath(pathname) {
  const p = String(pathname || '');
  let m = /\/(\d+p(?:-[a-z0-9]+)?)\/\d+p(?:-[a-z0-9]+)?_(\d{4})\.m4s$/i.exec(p);
  if (m) return { variant: m[1], segIdx: parseInt(m[2], 10), track: 0 };
  m = /\/(\d+p(?:-[a-z0-9]+)?)\/\d+p(?:-[a-z0-9]+)?_init\.mp4$/i.exec(p);
  if (m) return { variant: m[1], segIdx: -1, track: 0 };
  m = /_(\d+)_(\d{4})-(\d+)\.m4s$/i.exec(p);
  if (m) return { variant: m[1], segIdx: parseInt(m[2], 10), track: parseInt(m[3], 10) };
  m = /_(\d+)_init-(\d+)\.mp4$/i.exec(p);
  if (m) return { variant: m[1], segIdx: -1, track: parseInt(m[2], 10) };
  return null;
}

function loadWs() {
  try {
    return require('ws');
  } catch {
    return null;
  }
}

class PrimeloadSession {
  constructor(embedToken) {
    this.embedToken = embedToken;
    this.apiBase = 'https://primeload.co/api/v1';
    this.socketOrigin = 'https://primeload.co';
    this.sessionId = null;
    this.challenge = null;
    this.nonce = null;
    this.fingerprint = forgeFingerprint();
    this.masterUrl = null;
    this.videoId = null;
    this.contentId = null;
    this.socket = null;
    this.connected = false;
    this.ackId = 1;
    this.pending = new Map();
    this.createdAt = 0;
    this.expiresAt = 0;
    this._initPromise = null;
  }

  get key() {
    if (this.contentId && this.videoId) return `${this.contentId}/${this.videoId}`;
    return this.videoId || this.embedToken;
  }

  isFresh() {
    return this.connected && Date.now() < this.expiresAt;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._init().finally(() => {
      this._initPromise = null;
    });
    return this._initPromise;
  }

  async _init() {
    const jar = new Map();
    const referer = `https://primeload.co/player/${this.embedToken}`;
    const baseHeaders = {
      'User-Agent': PRIMELOAD_USER_AGENT,
      Accept: '*/*',
    };

    const pageRes = await axios.get(`https://primeload.co/player/${this.embedToken}`, {
      headers: {
        ...baseHeaders,
        Referer: `https://primeload.co/embed/${this.embedToken}`,
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: PRIMELOAD_AUTH_TIMEOUT_MS,
      maxRedirects: 5,
      responseType: 'text',
      validateStatus: (s) => s >= 200 && s < 400,
    });
    for (const [k, v] of parseCookies(pageRes.headers['set-cookie'])) jar.set(k, v);

    const attrs = extractPlayerAttrs(pageRes.data);
    this.sessionId = attrs.session || null;
    this.challenge = attrs.challenge || null;
    this.nonce = attrs.nonce || null;
    this.apiBase = attrs.api || this.apiBase;
    this.socketOrigin = attrs.socket || this.socketOrigin;

    const cookie = cookieHeader(jar);
    const xsrf = xsrfFromJar(jar);

    // Metadata (master playlist) — works with session cookies + CSRF
    const metaRes = await axios.get(`${this.apiBase}/player/${this.embedToken}`, {
      headers: {
        ...baseHeaders,
        Referer: referer,
        Origin: 'https://primeload.co',
        Accept: 'application/json',
        Cookie: cookie,
        ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
      },
      timeout: PRIMELOAD_API_TIMEOUT_MS,
      responseType: 'text',
      validateStatus: () => true,
    });
    if (metaRes.headers['set-cookie']) {
      for (const [k, v] of parseCookies(metaRes.headers['set-cookie'])) jar.set(k, v);
    }
    let meta = null;
    try {
      meta = JSON.parse(metaRes.data);
    } catch {
      meta = null;
    }
    if (metaRes.status >= 400 || !meta || !meta.master_manifest) {
      const err = new Error(`Primeload player API HTTP ${metaRes.status}`);
      err.code = 'PRIMELOAD_META';
      throw err;
    }
    this.masterUrl = meta.master_manifest;
    this.title = meta.title || null;
    try {
      const mu = new URL(this.masterUrl);
      const parts = mu.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('hls');
      if (idx >= 0) {
        this.contentId = parts[idx + 1] || null;
        this.videoId = parts[idx + 2] || null;
      }
    } catch {
      /* ignore */
    }

    // Attest challenge → ticket (challenge responses are not strictly validated)
    if (!this.sessionId || !this.challenge) {
      const boot = await axios.post(
        `${this.apiBase}/stream/bootstrap`,
        { embed_token: this.embedToken },
        {
          headers: {
            ...baseHeaders,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Referer: referer,
            Origin: 'https://primeload.co',
            Cookie: cookieHeader(jar),
            ...(xsrfFromJar(jar) ? { 'X-XSRF-TOKEN': xsrfFromJar(jar) } : {}),
          },
          timeout: PRIMELOAD_AUTH_TIMEOUT_MS,
          responseType: 'text',
          validateStatus: () => true,
        }
      );
      if (boot.headers['set-cookie']) {
        for (const [k, v] of parseCookies(boot.headers['set-cookie'])) jar.set(k, v);
      }
      try {
        const bj = JSON.parse(boot.data);
        if (bj.session_id) this.sessionId = bj.session_id;
        if (bj.challenge) this.challenge = bj.challenge;
        if (bj.nonce && !this.nonce) this.nonce = bj.nonce;
        if (bj.socket_url) this.socketOrigin = bj.socket_url;
      } catch {
        /* ignore */
      }
    }

    if (!this.sessionId || !this.challenge) {
      const err = new Error('Primeload session/challenge missing');
      err.code = 'PRIMELOAD_SESSION';
      throw err;
    }

    const attestBody = JSON.stringify({
      session_id: this.sessionId,
      nonce: this.challenge.nonce,
      responses: forgeResponses(this.challenge.tasks),
      fingerprint: this.fingerprint,
    });
    const attestRes = await axios.post(`${this.apiBase}/stream/attest`, attestBody, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: referer,
        Origin: 'https://primeload.co',
        Cookie: cookieHeader(jar),
        ...(xsrfFromJar(jar) ? { 'X-XSRF-TOKEN': xsrfFromJar(jar) } : {}),
      },
      timeout: PRIMELOAD_AUTH_TIMEOUT_MS,
      responseType: 'text',
      validateStatus: () => true,
    });
    if (attestRes.headers['set-cookie']) {
      for (const [k, v] of parseCookies(attestRes.headers['set-cookie'])) jar.set(k, v);
    }
    let ticket = null;
    try {
      const aj = JSON.parse(attestRes.data);
      ticket = aj.ticket || null;
      if (aj.session_id) this.sessionId = aj.session_id;
    } catch {
      /* ignore */
    }
    if (!ticket) {
      const err = new Error(`Primeload attest failed HTTP ${attestRes.status}`);
      err.code = 'PRIMELOAD_ATTEST';
      throw err;
    }

    await this._connectSocket(ticket);
    this.createdAt = Date.now();
    this.expiresAt = Date.now() + PRIMELOAD_SESSION_TTL_MS;
    if (this.key) sessionsByKey.set(this.key, this);
    return this;
  }

  _connectSocket(ticket) {
    const WebSocket = loadWs();
    if (!WebSocket) {
      const err = new Error('ws module not available for Primeload');
      err.code = 'PRIMELOAD_WS';
      return Promise.reject(err);
    }
    const wsUrl = `wss://primeload.co/api/socket/?EIO=4&transport=websocket&ticket=${encodeURIComponent(ticket)}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': PRIMELOAD_USER_AGENT,
          Origin: 'https://primeload.co',
        },
        handshakeTimeout: PRIMELOAD_WS_TIMEOUT_MS,
      });
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error('Primeload socket timeout'));
      }, PRIMELOAD_WS_TIMEOUT_MS);

      const fail = (err) => {
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        reject(err);
      };

      ws.on('error', (e) => fail(e));
      ws.on('close', () => {
        this.connected = false;
        this.socket = null;
        for (const p of this.pending.values()) {
          p.rej(new Error('Primeload socket closed'));
        }
        this.pending.clear();
      });
      ws.on('message', (data) => {
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        if (raw[0] === '0') {
          ws.send('40/video,');
          return;
        }
        if (raw[0] === '2') {
          ws.send(`3${raw.slice(1)}`);
          return;
        }
        if (raw[0] !== '4') return;
        const subtype = raw[1];
        if (subtype === '0') {
          clearTimeout(timer);
          this.socket = ws;
          this.connected = true;
          resolve(this);
          return;
        }
        if (subtype === '3') {
          let rest = raw.slice(2);
          if (rest.startsWith('/')) rest = rest.slice(rest.indexOf(',') + 1);
          const m = /^(\d+)([\s\S]*)$/.exec(rest);
          if (!m) return;
          const id = parseInt(m[1], 10);
          const p = this.pending.get(id);
          if (!p) return;
          this.pending.delete(id);
          let payload;
          try { payload = JSON.parse(m[2]); } catch { payload = []; }
          const first = Array.isArray(payload) ? payload[0] : payload;
          if (first && first.error) {
            p.rej(new Error(`${first.error}${first.ref ? ` ref=${first.ref}` : ''}`));
          } else {
            p.res(first);
          }
        }
      });
    });
  }

  emitAck(event, data) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Primeload socket not connected'));
    }
    const id = this.ackId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { res: resolve, rej: reject });
      this.socket.send(`42/video,${id}${JSON.stringify([event, data])}`);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Primeload getToken timeout'));
        }
      }, 8000);
    });
  }

  async getTokenForUrl(cdnUrl) {
    if (!this.isFresh()) {
      this.connected = false;
      try { if (this.socket) this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
      this._initPromise = null;
      await this.init();
    }
    let pathname = cdnUrl;
    try {
      pathname = new URL(cdnUrl).pathname;
    } catch {
      /* keep */
    }
    const isManifest = /\.m3u8($|\?)/i.test(String(cdnUrl).split('?')[0]) || /\.m3u8$/i.test(pathname);
    if (isManifest) {
      const res = await this.emitAck('getToken', {
        requestType: 'manifest',
        segmentUrl: pathname,
      });
      return res && res.token ? res : { token: res };
    }
    const seg = parseSegmentPath(pathname) || { variant: '0', segIdx: -1, track: 0 };
    const res = await this.emitAck('getToken', {
      requestType: 'segment',
      variant: seg.variant,
      segIdx: seg.segIdx,
      track: seg.track,
      segmentUrl: pathname,
    });
    return res && res.token ? res : { token: res };
  }

  async authorizeUrl(cdnUrl) {
    const tokenInfo = await this.getTokenForUrl(cdnUrl);
    const token = typeof tokenInfo === 'string' ? tokenInfo : tokenInfo.token;
    if (!token) throw new Error('Primeload empty token');
    const u = new URL(cdnUrl);
    u.searchParams.delete('pl_embed');
    u.searchParams.set('token', token);
    u.searchParams.set(
      'requestType',
      /\.m3u8($|\?)/i.test(u.pathname) ? 'manifest' : 'segment'
    );
    if (this.sessionId) u.searchParams.set('sessionId', this.sessionId);
    if (this.fingerprint) u.searchParams.set('fingerprint', this.fingerprint);
    const expires =
      tokenInfo && tokenInfo.expires
        ? tokenInfo.expires * 1000
        : null;
    return { url: u.toString(), expiresAt: expires };
  }

  close() {
    this.connected = false;
    try { if (this.socket) this.socket.close(); } catch { /* ignore */ }
    this.socket = null;
    this.pending.clear();
    if (this.key && sessionsByKey.get(this.key) === this) {
      sessionsByKey.delete(this.key);
    }
  }
}

async function getPrimeloadSession(embedToken) {
  if (!embedToken) throw new Error('Primeload embed token required');
  // Reuse any fresh session that was created for this embed token
  for (const s of sessionsByKey.values()) {
    if (s.embedToken === embedToken && s.isFresh()) return s;
  }
  const session = new PrimeloadSession(embedToken);
  await session.init();
  return session;
}

async function authorizePrimeloadCdnUrl(cdnUrl) {
  const key = sessionKeyFromCdnUrl(cdnUrl);
  if (!key) throw new Error('Not a Primeload CDN URL');

  let session = sessionsByKey.get(key);
  if (session && session.isFresh()) {
    return session.authorizeUrl(cdnUrl);
  }

  if (initInFlight.has(key)) {
    session = await initInFlight.get(key);
    return session.authorizeUrl(cdnUrl);
  }

  // Cold start (process restart / expired session): re-auth via pl_embed
  // carried on the original master URL by the resolver.
  if (!session) {
    let embed = null;
    try {
      embed = new URL(cdnUrl).searchParams.get('pl_embed');
    } catch {
      embed = null;
    }
    if (embed) {
      const p = getPrimeloadSession(embed);
      initInFlight.set(key, p);
      try {
        session = await p;
        return session.authorizeUrl(cdnUrl);
      } finally {
        initInFlight.delete(key);
      }
    }
    const err = new Error('Primeload session not available for CDN URL');
    err.code = 'PRIMELOAD_NO_SESSION';
    throw err;
  }

  // Stale but has embed token — re-init
  const p = session.init();
  initInFlight.set(key, p);
  try {
    session = await p;
    return session.authorizeUrl(cdnUrl);
  } finally {
    initInFlight.delete(key);
  }
}

function isPrimeloadCdnUrl(url) {
  try {
    const u = new URL(url);
    return PRIMELOAD_CDN_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

function isPrimeloadHostUrl(url) {
  try {
    const u = new URL(url);
    return PRIMELOAD_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

function extractEmbedToken(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/(?:embed|player)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

module.exports = {
  PrimeloadSession,
  getPrimeloadSession,
  authorizePrimeloadCdnUrl,
  isPrimeloadCdnUrl,
  isPrimeloadHostUrl,
  extractEmbedToken,
  sessionKeyFromCdnUrl,
  forgeFingerprint,
  forgeResponses,
};
