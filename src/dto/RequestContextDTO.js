function toRequestContextDTO(req) {
  return {
    language: req?.query?.language || req?.headers?.['accept-language']?.split(',')?.[0] || 'es-MX',
    country: null,
    platform: req?.headers?.['sec-ch-ua-platform'] || null,
    device: req?.headers?.['user-agent'] || null,
    clientVersion: req?.headers?.['x-client-version'] || null,
    userId: req?.query?.userId || null,
  };
}

module.exports = { toRequestContextDTO };