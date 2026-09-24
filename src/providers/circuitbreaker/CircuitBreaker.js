const { ProviderUnavailableError } = require('../errors/ProviderErrors');

const STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this._failureThreshold = options.failureThreshold || 5;
    this._halfOpenTimeoutMs = options.halfOpenTimeoutMs || 30000;
    this._state = STATE.CLOSED;
    this._failureCount = 0;
    this._lastFailureTime = null;
    this._halfOpenAttempted = false;
  }

  async call(fn) {
    if (this._state === STATE.OPEN) {
      if (Date.now() - this._lastFailureTime >= this._halfOpenTimeoutMs) {
        this._state = STATE.HALF_OPEN;
        this._halfOpenAttempted = false;
      } else {
        throw new ProviderUnavailableError(
          `Circuit breaker OPEN for ${this.name}`
        );
      }
    }

    if (this._state === STATE.HALF_OPEN && this._halfOpenAttempted) {
      throw new ProviderUnavailableError(
        `Circuit breaker HALF_OPEN for ${this.name}, probe in progress`
      );
    }

    if (this._state === STATE.HALF_OPEN) {
      this._halfOpenAttempted = true;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      if (err.retryable || err.code === 'PROVIDER_TIMEOUT' || err.code === 'PROVIDER_RATE_LIMIT') {
        this._onFailure();
      }
      throw err;
    }
  }

  _onSuccess() {
    this._failureCount = 0;
    this._state = STATE.CLOSED;
    this._halfOpenAttempted = false;
  }

  _onFailure() {
    this._failureCount++;
    this._lastFailureTime = Date.now();
    if (this._failureCount >= this._failureThreshold) {
      this._state = STATE.OPEN;
    }
  }

  get state() {
    return this._state;
  }

  get isOpen() {
    return this._state === STATE.OPEN;
  }

  reset() {
    this._state = STATE.CLOSED;
    this._failureCount = 0;
    this._lastFailureTime = null;
    this._halfOpenAttempted = false;
  }

  static get STATE() {
    return STATE;
  }
}

module.exports = { CircuitBreaker };