'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const axios = require('axios');
const { URL } = require('url');

// Agentes keep-alive compartidos por todos los resolvers (ver fetchOnce).
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 3000 });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 3000 });

const { DEFAULT_OPTIONS, CONTENT_TYPE_HINTS, RETRYABLE_STATUS_CODES } = require('./resolver.types');

const {
  InvalidSourceUrlError,
  SsrfDetectedError,
  ResolverTimeoutError,
  ResolverNetworkError,
  ResolverRateLimitedError,
  ResolverBlockedError,
  UpstreamError,
} = require('./resolver.errors');

const IPV4_PRIVATE = [
  { start: 0x00000000, end: 0x00ffffff }, // 0.0.0.0/8
  { start: 0x0a000000, end: 0x0affffff }, // 10.0.0.0/8
  { start: 0x7f000000, end: 0x7fffffff }, // 127.0.0.0/8
  { start: 0x64400000, end: 0x64ffffff }, // 100.64.0.0/10 (CGNAT)
  { start: 0xa9fe0000, end: 0xa9feffff }, // 169.254.0.0/16 (link-local)
  { start: 0xac100000, end: 0xac1fffff }, // 172.16.0.0/12
  { start: 0xc0a80000, end: 0xc0a8ffff }, // 192.168.0.0/16
  { start: 0xc0000200, end: 0xc00002ff }, // 192.0.2.0/24 (TEST-NET-1)
  { start: 0xc6120000, end: 0xc613ffff }, // 198.18.0.0/15 (benchmarking)
  { start: 0xc6336400, end: 0xc63364ff }, // 198.51.100.0/24 (TEST-NET-2)
  { start: 0xcb007100, end: 0xcb0071ff }, // 203.0.113.0/24 (TEST-NET-3)
  { start: 0xe0000000, end: 0xefffffff }, // 224.0.0.0/4 (multicast)
];

const ipv4ToInt = (ip) => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
};

function isPrivateIpv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return IPV4_PRIVATE.some((r) => value >= r.start && value <= r.end);
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower === '0:0:0:0:0:0:0:0' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower.startsWith('::ffff:')) {
    return isPrivateIpv4(lower.split(':').pop());
  }
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local / multicast-assigned blocks
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
  return false;
}

function isPrivateIp(ip) {
  return ip.includes(':') ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

function isUnsafeHostname(hostname) {
  if (!hostname) return true;
  const host = hostname.replace(/\[|\]/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  if (host.includes(':')) return isPrivateIpv6(host);
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.home.arpa')) return true;
  return false;
}

function parseUrl(urlLike) {
  let parsed;
  try {
    parsed = new URL(urlLike);
  } catch {
    throw new InvalidSourceUrlError(`Malformed URL: ${urlLike}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidSourceUrlError(`Unsupported protocol "${parsed.protocol}" in URL ${urlLike}`);
  }
  return parsed;
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '';
    }
    if (u.search) u.search = '?[redacted]';
    return u.toString();
  } catch {
    return String(url);
  }
}

async function lookupPublicAddresses(hostname) {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (!records || records.length === 0) return [];
  return records.map((r) => r.address);
}

async function assertSafePublicUrl(url, options = {}) {
  const { dnsCheck = true } = options;
  const parsed = parseUrl(url);
  if (isUnsafeHostname(parsed.hostname)) {
    throw new SsrfDetectedError(redactUrl(parsed));
  }
  if (parsed.protocol !== 'https:' && parsed.port) {
    throw new SsrfDetectedError(redactUrl(parsed));
  }
  if (dnsCheck) {
    let addresses;
    try {
      addresses = await lookupPublicAddresses(parsed.hostname);
    } catch (err) {
      throw new ResolverNetworkError(`DNS resolution failed for ${redactUrl(parsed)}`, { cause: err });
    }
    if (addresses.length === 0) {
      throw new ResolverNetworkError(`No DNS records for ${redactUrl(parsed)}`);
    }
    for (const address of addresses) {
      if (isPrivateIp(address)) {
        throw new SsrfDetectedError(`${redactUrl(parsed)} resolves to private address ${address}`);
      }
    }
  }
  return parsed;
}

function detectStreamType(url, contentType = '') {
  const ct = (contentType || '').toLowerCase();
  if (ct) {
    for (const hint of CONTENT_TYPE_HINTS) {
      if (hint.re.test(ct)) return hint.type;
    }
  }
  const path = (url || '').split('?')[0];
  if (/\.m3u8($|[?#])/i.test(path)) return 'hls';
  if (/\.mpd($|[?#])/i.test(path)) return 'dash';
  if (/\.(mp4|m4v|mov|webm|mkv)($|[?#])/i.test(path)) return 'mp4';
  return 'unknown';
}

function isTransientStatus(status) {
  return RETRYABLE_STATUS_CODES.includes(status);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyHttpError(err) {
  if (!err || !err.isAxiosError) return null;
  const status = err.response ? err.response.status : null;
  const code = err.code;
  if (status === 429) return 'rate-limit';
  if (status === 401 || status === 403) return 'blocked';
  if (status >= 500 && status <= 504) return 'upstream';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
  if (code && /^(ENOTFOUND|EHOSTUNREACH|ECONNREFUSED|ECONNRESET|EPIPE|ENETUNREACH|EAI_AGAIN)$/.test(code)) return 'network';
  return 'unknown';
}

function toResolverError(err, url) {
  const kind = classifyHttpError(err);
  const target = redactUrl(url || (err && err.config && err.config.url) || '');
  switch (kind) {
    case 'timeout':
      return new ResolverTimeoutError(`Request timed out for ${target}`, { cause: err });
    case 'network':
      return new ResolverNetworkError(`Network error requesting ${target}`, { cause: err });
    case 'rate-limit':
      return new ResolverRateLimitedError(`Rate limited while requesting ${target}`, { cause: err });
    case 'blocked':
      return new ResolverBlockedError(`Request blocked for ${target}`, { cause: err });
    case 'upstream':
      return new UpstreamError(`Upstream server error requesting ${target}`, { cause: err });
    default:
      return err;
  }
}

function createResolverFetcher(options = {}) {
  const opts = {
    httpTimeoutMs: options.httpTimeoutMs || DEFAULT_OPTIONS.httpTimeoutMs,
    maxRedirects: options.maxRedirects || DEFAULT_OPTIONS.maxRedirects,
    maxAttempts: options.maxAttempts || DEFAULT_OPTIONS.maxAttempts,
    backoffBaseMs: options.backoffBaseMs || DEFAULT_OPTIONS.backoffBaseMs,
    defaultHeaders: { 'User-Agent': DEFAULT_OPTIONS.defaultUserAgent, ...(options.headers || {}) },
  };

  async function fetch(url, config = {}) {
    const headers = { ...opts.defaultHeaders, ...(config.headers || {}) };
    const timeoutMs = config.timeoutMs || opts.httpTimeoutMs;
    let lastError;

    for (let attempt = 0; attempt <= opts.maxAttempts; attempt++) {
      try {
        return await fetchOnce(url, {
          method: config.method || 'GET',
          headers,
          data: config.data,
          responseType: config.responseType || 'text',
          timeoutMs,
          dnsCheck: config.dnsCheck !== false,
        });
      } catch (err) {
        lastError = err;
        if (!err || !err.retryable) throw err;
        if (attempt >= opts.maxAttempts) break;
        await sleep(opts.backoffBaseMs * Math.pow(2, attempt));
      }
    }
    throw lastError;
  }

  async function fetchOnce(url, config) {
    let current = url;

    for (let hop = 0; ; hop++) {
      const parsed = await assertSafePublicUrl(current, { dnsCheck: config.dnsCheck });
      let response;
      try {
        response = await axios({
          method: config.method,
          url: parsed.toString(),
          headers: config.headers,
          data: config.data,
          responseType: config.responseType,
          timeout: config.timeoutMs,
          maxRedirects: 0,
          validateStatus: () => true,
          // Keep-alive: los resolvers hacen 2-4 requests al mismo host por
          // resolución (embed → redirects → API); reutilizar TLS ahorra
          // ~100-300ms por round-trip.
          httpAgent: module.exports._keepAliveHttpAgent,
          httpsAgent: module.exports._keepAliveHttpsAgent,
        });
      } catch (err) {
        throw toResolverError(err, parsed.toString());
      }

      const status = response.status;
      const location = response.headers && response.headers.location;
      if (status >= 300 && status < 400 && location) {
        if (hop >= opts.maxRedirects) {
          throw new ResolverNetworkError(`Too many redirects resolving ${redactUrl(current)}`);
        }
        let next;
        try {
          next = new URL(location, parsed).toString();
        } catch {
          throw new InvalidSourceUrlError(`Invalid redirect location from ${redactUrl(current)}`);
        }
        current = next;
        continue;
      }
      return {
        status,
        statusText: response.statusText,
        headers: response.headers || {},
        body: response.data,
        finalUrl: current,
      };
    }
  }

  return fetch;
}

module.exports = {
  _keepAliveHttpAgent: keepAliveHttpAgent,
  _keepAliveHttpsAgent: keepAliveHttpsAgent,
  parseUrl,
  assertSafePublicUrl,
  isUnsafeHostname,
  isPrivateIp,
  isPrivateIpv4,
  isPrivateIpv6,
  redactUrl,
  detectStreamType,
  createResolverFetcher,
  toResolverError,
  classifyHttpError,
  isTransientStatus,
  sleep,
};