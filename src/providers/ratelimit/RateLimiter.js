class RateLimiter {
  constructor(name, maxRequests = 60, windowMs = 60000) {
    this.name = name;
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this._tokens = [];
  }

  async acquire() {
    const now = Date.now();
    this._tokens = this._tokens.filter(t => now - t < this.windowMs);

    if (this._tokens.length >= this.maxRequests) {
      const oldest = this._tokens[0];
      const waitMs = this.windowMs - (now - oldest) + 10;
      await this._sleep(waitMs);
      return this.acquire();
    }

    this._tokens.push(now);
  }

  get remaining() {
    const now = Date.now();
    this._tokens = this._tokens.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxRequests - this._tokens.length);
  }

  get isLimited() {
    return this.remaining === 0;
  }

  reset() {
    this._tokens = [];
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { RateLimiter };