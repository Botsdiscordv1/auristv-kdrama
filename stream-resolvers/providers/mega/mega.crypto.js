'use strict';

const crypto = require('crypto');

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeFileKey(encodedKey) {
  const buf = base64UrlDecode(encodedKey);
  return buf;
}

function deriveAesKey(fileKey) {
  if (!Buffer.isBuffer(fileKey) || fileKey.length !== 32) {
    throw new Error('MEGA file key must decode to 32 bytes');
  }
  const aesKey = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    aesKey[i] = fileKey[i] ^ fileKey[16 + i];
  }
  return aesKey;
}

function ctrNonce(fileKey, start = 0) {
  if (!Buffer.isBuffer(fileKey) || fileKey.length !== 32) {
    throw new Error('MEGA file key must decode to 32 bytes');
  }
  if (start < 0 || !Number.isInteger(start) || start % 16 !== 0) {
    throw new Error('MEGA CTR decrypt start must be a non-negative multiple of 16');
  }
  // MEGA keeps the block counter in the last 8 bytes of the 16-byte IV and the
  // file-key-derived nonce in the first 8 bytes (see megajs CTR class).
  const iv = Buffer.alloc(16);
  fileKey.copy(iv, 0, 16, 24);
  iv.writeBigUInt64BE(BigInt(start) / 16n, 8);
  return iv;
}

function decryptAttributes(encryptedMetadata, aesKey) {
  if (!Buffer.isBuffer(aesKey) || aesKey.length !== 16) {
    throw new Error('MEGA AES key must be 16 bytes');
  }
  const ciphertext = Buffer.isBuffer(encryptedMetadata)
    ? encryptedMetadata
    : base64UrlDecode(encryptedMetadata);
  if (!ciphertext || ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    return null;
  }
  const iv = Buffer.alloc(16, 0);
  const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  let end = 0;
  while (end < decrypted.length && decrypted.readUInt8(end) !== 0) end++;
  const raw = decrypted.slice(0, end).toString('utf8');
  if (!raw.startsWith('MEGA')) return null;
  const payload = raw.slice(4);
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function decryptMetadata(encryptedMetadata, fileKey) {
  if (typeof encryptedMetadata !== 'string' || !encryptedMetadata) return null;
  const keyBuf = typeof fileKey === 'string' ? decodeFileKey(fileKey) : fileKey;
  const aesKey = deriveAesKey(keyBuf);
  return decryptAttributes(encryptedMetadata, aesKey);
}

module.exports = {
  base64UrlDecode,
  base64UrlEncode,
  decodeFileKey,
  deriveAesKey,
  ctrNonce,
  decryptAttributes,
  decryptMetadata,
};