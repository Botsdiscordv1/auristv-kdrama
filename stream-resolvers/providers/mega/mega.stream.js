'use strict';

const crypto = require('crypto');
const { Transform } = require('stream');
const { parseMegaUrl } = require('./mega.parser');
const { decodeFileKey, deriveAesKey, ctrNonce } = require('./mega.crypto');

const BLOCK = 16;

// AES-128-CTR decryptor that follows MEGA's scheme (nonce from fileKey[16..24],
// block counter in the last 8 bytes of the IV). Resumes from an arbitrary byte
// offset by aligning it down to the last 16-byte block boundary and discarding
// the excess leading bytes, so browser Range/seek requests work seamlessly.
function createMegaDecryptStream(fileKey, start = 0) {
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0) {
    throw new Error('MEGA decrypt start must be a non-negative integer');
  }
  const aesKey = deriveAesKey(fileKey);
  const alignedStart = Math.floor(start / BLOCK) * BLOCK;
  const discard = start - alignedStart;

  const iv = ctrNonce(fileKey, alignedStart);
  const decipher = crypto.createDecipheriv('aes-128-ctr', aesKey, iv);
  decipher.setAutoPadding(false);

  let skipped = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        let data = decipher.update(chunk);
        if (skipped < discard) {
          const toSkip = Math.min(discard - skipped, data.length);
          skipped += toSkip;
          data = data.subarray(toSkip);
        }
        callback(null, data);
      } catch (err) {
        callback(err);
      }
    },
    flush(callback) {
      try {
        const tail = decipher.final();
        if (tail && tail.length > 0 && skipped >= discard) {
          callback(null, tail);
        } else {
          callback();
        }
      } catch (err) {
        callback(err);
      }
    },
  });
}

function megaKeyFromUrl(inputUrl) {
  const parsed = parseMegaUrl(inputUrl);
  if (!parsed || parsed.type !== 'file' || !parsed.fileId || !parsed.key) {
    return null;
  }
  const fileKey = decodeFileKey(parsed.key);
  if (!Buffer.isBuffer(fileKey) || fileKey.length !== 32) {
    return null;
  }
  return fileKey;
}

module.exports = {
  createMegaDecryptStream,
  megaKeyFromUrl,
  BLOCK,
};