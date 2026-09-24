class Backoff {
  constructor(options = {}) {
    this._baseMs = options.baseMs || 500;
    this._maxAttempts = options.maxAttempts || 3;
  }

  async wait(attempt) {
    if (attempt >= this._maxAttempts) {
      return false;
    }
    const delay = this._baseMs * Math.pow(2, attempt);
    await this._sleep(delay);
    return true;
  }

  get maxAttempts() {
    return this._maxAttempts;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { Backoff };