function toCacheMetadataDTO(hit, key = null, ttl = null) {
  return {
    hit,
    key,
    ttl,
    generatedAt: hit ? null : new Date().toISOString(),
  };
}

module.exports = { toCacheMetadataDTO };