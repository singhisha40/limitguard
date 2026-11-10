// In dev, Vite proxies these paths to the Express server. In production set VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, ok: res.ok, headers: res.headers, body };
}

export const api = {
  health: () => request('/health'),
  stats: (buckets = 30) => request(`/api/stats?buckets=${buckets}`),
  events: (limit = 15) => request(`/api/events?limit=${limit}`),
  rules: () => request('/api/rules'),
  createRule: (rule) => request('/api/rules', { method: 'POST', body: JSON.stringify(rule) }),
  updateRule: (name, rule) => request(`/api/rules/${name}`, { method: 'PUT', body: JSON.stringify(rule) }),
  deleteRule: (name) => request(`/api/rules/${name}`, { method: 'DELETE' }),
  race: (limit, requests) => request('/api/demo/race', { method: 'POST', body: JSON.stringify({ limit, requests }) }),
  hit: (path, method = 'GET') => request(path, { method }),
};
