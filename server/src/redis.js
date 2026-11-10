const Redis = require('ioredis');
const { redisUrl } = require('./config');

function createRedis(url = redisUrl) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1, // fail fast so the fail-open/closed policy can kick in
    enableOfflineQueue: false, // never queue commands while disconnected
    commandTimeout: 500, // a hung Redis must not hang every API request
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', () => {
    /* connection errors are handled per request by the limiter policy */
  });
  return client;
}

/** Resolves once the client is connected, or after timeoutMs (the service still starts, degraded). */
function waitUntilReady(client, timeoutMs = 3000) {
  if (client.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    client.once('ready', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

module.exports = { createRedis, waitUntilReady };
