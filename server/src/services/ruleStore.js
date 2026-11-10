const DEFAULT_RULES = [
  {
    name: 'default',
    algorithm: 'token_bucket',
    limit: 10,
    windowSec: 10,
    keyBy: 'ip',
    enabled: true,
    description: 'General API traffic: bursts of 10, refills 1 token per second',
  },
  {
    name: 'strict',
    algorithm: 'sliding_window',
    limit: 3,
    windowSec: 10,
    keyBy: 'ip',
    enabled: true,
    description: 'Expensive endpoints: exactly 3 requests in any 10 second window',
  },
  {
    name: 'login',
    algorithm: 'fixed_window',
    limit: 5,
    windowSec: 60,
    keyBy: 'ip',
    enabled: true,
    description: 'Login attempts: 5 per minute (cheap fixed window)',
  },
];

/**
 * Keeps rules in memory so the hot path (every request) never waits on MongoDB.
 * Rules are reloaded at most once per ttlMs. Edits made through the API call
 * invalidate() so they apply on this instance immediately; other instances
 * pick them up within ttlMs. That is the consistency tradeoff, documented in the README.
 */
class RuleStore {
  constructor({ loader, ttlMs = 5000, defaults = DEFAULT_RULES }) {
    this.loader = loader;
    this.ttlMs = ttlMs;
    this.defaults = defaults;
    this.rules = new Map();
    this.loadedAt = 0;
    this.inflight = null;
  }

  async refreshIfStale() {
    if (Date.now() - this.loadedAt < this.ttlMs) return;
    if (!this.inflight) {
      // one reload at a time, even if 1000 requests arrive together
      this.inflight = this._reload().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
  }

  async _reload() {
    try {
      const rules = await this.loader();
      this.rules = new Map(rules.map((r) => [r.name, r]));
    } catch (err) {
      // Mongo unreachable: keep serving the last known rules (or built-ins on a cold start)
      if (this.rules.size === 0) {
        this.rules = new Map(this.defaults.map((r) => [r.name, r]));
      }
    } finally {
      this.loadedAt = Date.now();
    }
  }

  async get(name) {
    await this.refreshIfStale();
    return this.rules.get(name) || null;
  }

  async list() {
    await this.refreshIfStale();
    return [...this.rules.values()];
  }

  invalidate() {
    this.loadedAt = 0;
  }
}

module.exports = { RuleStore, DEFAULT_RULES };
