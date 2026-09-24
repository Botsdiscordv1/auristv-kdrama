'use strict';

const { STREAM_TYPES } = require('./resolver.types');

class ResolverResult {
  constructor(data) {
    this.success = Boolean(data.success);
    this.provider = data.provider || null;
    this.sourceUrl = data.sourceUrl || null;
    this.streamUrl = data.streamUrl || null;
    this.type = data.type || STREAM_TYPES.UNKNOWN;
    this.headers = data.headers || {};
    this.expiresAt = data.expiresAt || null;
    this.title = data.title || null;
    this.metadata = data.metadata || {};
    this.error = data.error || null;
  }

  static ok({ provider, streamUrl, type = STREAM_TYPES.UNKNOWN, headers = {}, expiresAt = null, sourceUrl = null, title = null, metadata = {} }) {
    return new ResolverResult({
      success: true,
      provider,
      sourceUrl,
      streamUrl,
      type,
      headers,
      expiresAt,
      title,
      metadata,
    });
  }

  static fail({ provider, error, streamUrl = null, type = STREAM_TYPES.UNKNOWN, headers = {}, expiresAt = null }) {
    return new ResolverResult({
      success: false,
      provider,
      sourceUrl: null,
      streamUrl,
      type,
      headers,
      expiresAt,
      title: null,
      metadata: {},
      error: {
        code: error.code,
        message: error.message,
        retryable: Boolean(error.retryable),
      },
    });
  }

  toJSON() {
    return {
      success: this.success,
      provider: this.provider,
      sourceUrl: this.sourceUrl,
      streamUrl: this.streamUrl,
      type: this.type,
      headers: this.headers,
      expiresAt: this.expiresAt,
      title: this.title,
      metadata: this.metadata,
      error: this.error,
    };
  }
}

module.exports = { ResolverResult };