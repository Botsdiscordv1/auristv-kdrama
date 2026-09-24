'use strict';

const crypto = require('crypto');

const { BYSE_VERSION_MAX, BYSE_GCM_TAG_BYTES, BYSE_KEY_PART_MAX } = require('./byse.constants');

const ALGO = 'aes-256-gcm';

function fromB64Url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function toB64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function selectIndices(version, total) {
  const v = String(version == null ? '' : version).trim();
  if (!/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  if (n < 1 || n > BYSE_VERSION_MAX) return null;
  const a = n;
  const b = 31 - n;
  if (a < 1 || b < 1 || a > total || b > total) return null;
  return [a, b];
}

function selectKeyParts(playback) {
  const parts = Array.isArray(playback && playback.key_parts) ? playback.key_parts : [];
  const sel = selectIndices(playback && playback.version, parts.length);
  if (!sel) return parts;
  const picked = sel.map((o) => parts[o - 1]).filter((o) => typeof o === 'string' && o.length > 0);
  return picked.length > 0 ? picked : parts;
}

function deriveKey(playback) {
  const selected = selectKeyParts(playback);
  return Buffer.concat(selected.map(fromB64Url));
}

/**
 * Decrypts the Byse `/api/videos/{code}` playback envelope.
 *
 * The server ships the key already split across `key_parts` (rotated by
 * `version`) together with `iv` and `payload`, so decryption is a plain local
 * decode of data the server itself provided — no token, CAPTCHA or fingerprint
 * is involved.
 *
 * @param {object} playback - `/api/videos/{code}` `.playback` object.
 * @returns {string} Decrypted JSON text.
 * @throws {Error} When the envelope is missing or unreadable.
 */
function decryptPlayback(playback) {
  if (!playback || typeof playback !== 'object') {
    throw new TypeError('BYSE playback envelope must be an object');
  }
  if (!Array.isArray(playback.key_parts) || playback.key_parts.length === 0) {
    throw new Error('BYSE playback envelope has no key_parts');
  }
  const key = deriveKey(playback);
  const iv = fromB64Url(playback.iv);
  const ciphertext = fromB64Url(playback.payload);

  if (iv.length === 0) throw new Error('BYSE playback envelope has an empty IV');
  if (ciphertext.length <= BYSE_GCM_TAG_BYTES) {
    throw new Error('BYSE playback ciphertext is too short');
  }

  const encrypted = ciphertext.slice(0, ciphertext.length - BYSE_GCM_TAG_BYTES);
  const tag = ciphertext.slice(ciphertext.length - BYSE_GCM_TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Builds a Byse-shaped playback envelope for a raw key (test helper).
 *
 * The whole key is split into `partsCount` base64url chunks and `version` is
 * chosen so the client-side selection (`[version, 31-version]`) reconstructs
 * the key when both parts are concatenated.
 *
 * @param {Buffer|string} rawKey - 256-bit key material.
 * @param {string} plaintext - JSON text to encrypt.
 * @param {object} [options]
 * @param {number} [options.partsCount] - size of key_parts array.
 * @param {string} [options.version] - selection version.
 * @returns {object} `{ algorithm, iv, payload, key_parts, version }`.
 */
function buildPlaybackEnvelope(rawKey, plaintext, options = {}) {
  const key = Buffer.from(rawKey);
  if (key.length !== 32) throw new Error('BYSE test key must be 32 bytes');
  const partsCount = options.partsCount || BYSE_KEY_PART_MAX;
  if (partsCount < 30) throw new Error('BYSE partsCount must be at least 30');
  const version = options.version || '20';
  const sel = selectIndices(version, partsCount);
  if (!sel) throw new Error('Invalid version for the given partsCount');

  const parts = new Array(partsCount);
  for (let i = 0; i < partsCount; i += 1) {
    parts[i] = toB64Url(crypto.randomBytes(24));
  }
  const first = sel[0] - 1;
  const second = sel[1] - 1;
  parts[first] = toB64Url(key.subarray(0, 16));
  parts[second] = toB64Url(key.subarray(16));

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const payload = Buffer.concat([ciphertext, cipher.getAuthTag()]);

  return {
    algorithm: 'AES-256-GCM',
    iv: toB64Url(iv),
    payload: toB64Url(payload),
    key_parts: parts,
    version,
  };
}

module.exports = {
  decryptPlayback,
  buildPlaybackEnvelope,
  deriveKey,
  ALGO,
  fromB64Url,
  toB64Url,
};
