const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const ALGORITHMS = ['token_bucket', 'sliding_window', 'fixed_window'];

function loadScript(name) {
  return fs.readFileSync(path.join(__dirname, `${name}.lua`), 'utf8');
}

/**
 * Registers the Lua scripts on a Redis client and returns a `check` function.
 * ioredis sends EVALSHA and falls back to EVAL on NOSCRIPT, so the script body
 * is only shipped over the network once per Redis restart.
 */
function createLimiter(redis) {
  redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: loadScript('token_bucket') });
  redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: loadScript('sliding_window') });
  redis.defineCommand('fixedWindow', { numberOfKeys: 1, lua: loadScript('fixed_window') });

  /**
   * @param {{name:string, algorithm:string, limit:number, windowSec:number}} rule
   * @param {string} identifier  who is being limited (ip, api key, user id)
   * @param {number} cost        tokens consumed (token bucket only)
   */
  async function check(rule, identifier, cost = 1) {
    const key = `rl:${rule.name}:${identifier}`;
    const windowMs = rule.windowSec * 1000;
    let res;

    switch (rule.algorithm) {
      case 'token_bucket': {
        const refillPerSec = rule.limit / rule.windowSec;
        res = await redis.tokenBucket(key, rule.limit, refillPerSec, cost);
        break;
      }
      case 'sliding_window':
        res = await redis.slidingWindow(key, rule.limit, windowMs, randomUUID());
        break;
      case 'fixed_window':
        res = await redis.fixedWindow(key, rule.limit, windowMs);
        break;
      default:
        throw new Error(`Unknown algorithm: ${rule.algorithm}`);
    }

    const [allowed, remaining, retryAfterMs] = res.map(Number);
    return { allowed: allowed === 1, remaining, retryAfterMs, limit: rule.limit };
  }

  return { check };
}

module.exports = { createLimiter, ALGORITHMS };
