const VERSION = '3.0';

function toResponseMetadataDTO({ executionTimeMs, cache = null, pagination = null } = {}) {
  return {
    version: VERSION,
    timestamp: new Date().toISOString(),
    executionTimeMs: executionTimeMs ?? 0,
    cache,
    pagination,
  };
}

module.exports = { toResponseMetadataDTO };