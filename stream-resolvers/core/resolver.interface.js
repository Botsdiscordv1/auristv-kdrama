'use strict';

class StreamResolver {
  constructor(providerId) {
    if (!providerId || typeof providerId !== 'string') {
      throw new Error('StreamResolver requires a providerId string');
    }
    this.providerId = providerId;
  }

  canResolve(url) {
    throw new Error('Not implemented');
  }

  async resolve(url, options = {}) {
    throw new Error('Not implemented');
  }
}

module.exports = { StreamResolver };