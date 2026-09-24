'use strict';

const crypto = require('crypto');

const { PROTOCOL, IV_CANDIDATES } = require('./upnshare.constants');

const ALGO = 'aes-128-cbc';

/**
 * Decrypts an AES-CBC hex payload produced by the UPnShare /api/v1/video
 * endpoint. Key and IV are the plain (UTF-8) protocol string; several known
 * IVs are tried in order to stay compatible across player forks.
 *
 * A wrong-IV decrypt can occasionally produce garbage with a coincidentally
 * valid PKCS#7 pad. When {@code requireJson} is set the result is only
 * accepted if it parses as a JSON object, mirroring how the reference player
 * validates the response before reading {@code "source"}.
 *
 * @param {string} payload Hex-encoded ciphertext (whitespace is ignored).
 * @param {object} [options]
 * @param {string} [options.protocol] Player protocol key material.
 * @param {boolean} [options.requireJson] Only honour outputs that parse as JSON.
 * @returns {string} Decrypted UTF-8 JSON payload.
 * @throws {Error} When no candidate IV yields PKCS#7-valid plaintext.
 */
function decryptPayload(payload, options = {}) {
  const { protocol = PROTOCOL, requireJson = false } = options;
  if (typeof payload !== 'string') {
    throw new TypeError('UPnShare payload must be a string');
  }
  const hex = String(payload).replace(/\s+/g, '');
  if (!hex) {
    throw new Error('UPnShare payload is empty');
  }
  if (hex.length % 2 !== 0) {
    throw new Error('UPnShare payload is not valid hex (odd length)');
  }
  const ciphertext = Buffer.from(hex, 'hex');
  if (ciphertext.length === 0) {
    throw new Error('UPnShare payload produced no ciphertext bytes');
  }
  const key = Buffer.from(protocol, 'utf8');

  const accepts = requireJson
    ? (text) => {
        try {
          const value = JSON.parse(text);
          return value && typeof value === 'object' && !Array.isArray(value);
        } catch {
          return false;
        }
      }
    : () => true;

  let lastError = null;
  for (const ivCandidate of IV_CANDIDATES) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivCandidate, 'utf8'));
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const text = plaintext.toString('utf8');
      if (accepts(text)) return text;
      lastError = new Error('plaintext is not valid JSON');
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`UPnShare payload could not be decrypted: ${lastError ? lastError.message : 'no candidate IV'}`);
}

/**
 * Encrypts a JSON payload the same way the player would, so tests and any
 * fixture generator can produce real ciphertext.
 *
 * @param {string|object} json JSON-compatible value to encrypt.
 * @param {string} [protocol] Player protocol key material.
 * @param {string} [iv] Initialization vector (first candidate by default).
 * @returns {string} Hex-encoded ciphertext.
 */
function encryptPayload(json, protocol = PROTOCOL, iv = IV_CANDIDATES[0]) {
  const data = typeof json === 'string' ? json : JSON.stringify(json);
  const cipher = crypto.createCipheriv(ALGO, Buffer.from(protocol, 'utf8'), Buffer.from(iv, 'utf8'));
  return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('hex');
}

module.exports = { decryptPayload, encryptPayload, ALGO, PROTOCOL, IV_CANDIDATES };