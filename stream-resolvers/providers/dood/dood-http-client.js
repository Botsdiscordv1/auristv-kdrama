'use strict';

// Chrome TLS-fingerprinted HTTP client (HTTP/2 primary, HTTP/1.1 fallback).
//
// Mirror hosts that back DoodStream (e.g. playmogo.com) reject Node's default
// TLS fingerprint with a Cloudflare 403 "Just a moment...". Impersonating
// Chrome at the transport layer (cipher order, ALPN, HTTP/2 settings, sec-*
// headers) is enough to pass the TLS/UA checks and load the embed page.
//
// Ported/adapted from sharoon7171/doodstream-direct-resolver (zero-dependency)
// to CommonJS, with per-request timeouts and public-address (SSRF) checks.

const http2 = require('node:http2');
const https = require('node:https');
const tls = require('node:tls');
const { brotliDecompressSync, gunzipSync } = require('node:zlib');

const { assertSafePublicUrl } = require('../../core/resolver.utils');

const SSL_OP_TLSEXT_PADDING = 1 << 4;
const SSL_OP_NO_ENCRYPT_THEN_MAC = 1 << 19;

const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const CHROME_H2_SETTINGS = {
  headerTableSize: 65536,
  enablePush: false,
  initialWindowSize: 6291456,
  maxFrameSize: 16384,
  maxConcurrentStreams: 1000,
  maxHeaderListSize: 262144,
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CLIENT_HINTS = {
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 10;

const sessions = new Map();

function chromeTlsOptions(hostname) {
  return {
    host: hostname,
    port: 443,
    servername: hostname,
    ALPNProtocols: ['h2', 'http/1.1'],
    ciphers: CHROME_CIPHERS,
    sigalgs:
      'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512',
    ecdhCurve: 'X25519:prime256v1:secp384r1',
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    secureOptions: SSL_OP_TLSEXT_PADDING | SSL_OP_NO_ENCRYPT_THEN_MAC,
  };
}

function getSession(origin) {
  if (sessions.has(origin)) {
    const session = sessions.get(origin);
    if (!session.closed && !session.destroyed) {
      return session;
    }
    sessions.delete(origin);
  }
  const url = new URL(origin);
  const session = http2.connect(origin, {
    settings: CHROME_H2_SETTINGS,
    createConnection: () => tls.connect(chromeTlsOptions(url.hostname)),
  });
  session.on('error', () => sessions.delete(origin));
  session.on('close', () => sessions.delete(origin));
  sessions.set(origin, session);
  return session;
}

function decodeBody(buffer, encoding) {
  if (encoding === 'br') {
    return brotliDecompressSync(buffer);
  }
  if (encoding === 'gzip') {
    return gunzipSync(buffer);
  }
  return buffer;
}

function chromeHeaders(accept, dest, mode, site, extra) {
  return {
    'user-agent': USER_AGENT,
    accept,
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    ...CLIENT_HINTS,
    'sec-fetch-dest': dest,
    'sec-fetch-mode': mode,
    'sec-fetch-site': site,
    ...(extra || {}),
  };
}

function documentHeaders() {
  return chromeHeaders(
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'document',
    'navigate',
    'none',
    { 'sec-fetch-user': '?1', 'upgrade-insecure-requests': '1', priority: 'u=0, i' }
  );
}

function fetchHeaders() {
  return chromeHeaders('*/*', 'empty', 'cors', 'same-origin');
}

function h2Request(urlStr, headers, timeoutMs, redirects) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const url = new URL(urlStr);
    const session = getSession(url.origin);
    const req = session.request({
      ':method': 'GET',
      ':path': `${url.pathname}${url.search}`,
      ':authority': url.host,
      ':scheme': 'https',
      ...headers,
    });

    const timer = setTimeout(() => {
      req.destroy(new Error('Dood request timed out'));
    }, timeoutMs);

    const chunks = [];

    req.on('response', (responseHeaders) => {
      const status = Number(responseHeaders[':status']);
      if ([301, 302, 307, 308].includes(status) && responseHeaders.location && redirects < MAX_REDIRECTS) {
        req.close();
        const nextUrl = new URL(responseHeaders.location, url).href;
        h2Request(nextUrl, headers, timeoutMs, redirects + 1).then(
          (v) => finish(resolve, v),
          (e) => finish(reject, e)
        );
        return;
      }
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        finish(resolve, {
          status,
          url: urlStr,
          headers: responseHeaders,
          body: decodeBody(raw, responseHeaders['content-encoding']).toString('utf8'),
        });
      });
    });
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

function h1Request(urlStr, headers, timeoutMs, redirects) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        servername: url.hostname,
        ...chromeTlsOptions(url.hostname),
        ALPNProtocols: ['http/1.1'],
      },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < MAX_REDIRECTS) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).href;
          h1Request(nextUrl, headers, timeoutMs, redirects + 1).then(
            (v) => finish(resolve, v),
            (e) => finish(reject, e)
          );
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          finish(resolve, {
            status: res.statusCode,
            url: urlStr,
            headers: res.headers,
            body: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf8'),
          });
        });
      }
    );
    const timer = setTimeout(() => req.destroy(new Error('Dood request timed out')), timeoutMs);
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

async function fetchText(urlStr, extraHeaders, mode, timeoutMs) {
  const safeUrl = await assertSafePublicUrl(urlStr, { dnsCheck: true });
  const headers = mode === 'fetch'
    ? { ...fetchHeaders(), ...(extraHeaders || {}) }
    : { ...documentHeaders(), ...(extraHeaders || {}) };
  try {
    return await h2Request(safeUrl.toString(), headers, timeoutMs || DEFAULT_TIMEOUT_MS, 0);
  } catch {
    return h1Request(safeUrl.toString(), headers, timeoutMs || DEFAULT_TIMEOUT_MS, 0);
  }
}

module.exports = { fetchText };
