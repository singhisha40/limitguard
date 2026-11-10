import React, { useState } from 'react';
import { api } from '../api.js';

const ENDPOINTS = [
  { path: '/api/protected/ping', method: 'GET', label: 'GET /api/protected/ping  (rule: default, token bucket)' },
  { path: '/api/protected/search', method: 'GET', label: 'GET /api/protected/search  (rule: strict, sliding window)' },
  { path: '/api/protected/login', method: 'POST', label: 'POST /api/protected/login  (rule: login, fixed window)' },
];

export default function Playground() {
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(15);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  const fire = async (n, parallel) => {
    const ep = ENDPOINTS[idx];
    setBusy(true);
    const one = async () => {
      const t0 = performance.now();
      const res = await api.hit(ep.path, ep.method).catch(() => null);
      const entry = res
        ? {
            id: crypto.randomUUID(),
            status: res.status,
            remaining: res.headers.get('ratelimit-remaining'),
            retry: res.headers.get('retry-after'),
            degraded: res.headers.get('x-ratelimit-status') === 'degraded',
            ms: Math.round(performance.now() - t0),
          }
        : { id: crypto.randomUUID(), status: 0, ms: 0 };
      setLog((l) => [entry, ...l].slice(0, 200));
    };
    if (parallel) await Promise.all(Array.from({ length: n }, one));
    else for (let i = 0; i < n; i++) await one();
    setBusy(false);
  };

  const allowed = log.filter((l) => l.status === 200).length;
  const blocked = log.filter((l) => l.status === 429).length;

  return (
    <div className="card">
      <h2>Playground</h2>
      <p className="sub">Call a protected endpoint and watch the headers. Rules are per client IP, so everything you send here shares one bucket.</p>
      <div className="row">
        <label className="field" style={{ flex: 1, minWidth: 260 }}>
          Endpoint
          <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
            {ENDPOINTS.map((e, i) => <option key={e.path} value={i}>{e.label}</option>)}
          </select>
        </label>
        <label className="field">
          Burst size
          <input type="number" min="1" max="200" value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} style={{ width: 90 }} />
        </label>
        <button className="btn" disabled={busy} onClick={() => fire(1, false)}>Send 1</button>
        <button className="btn" disabled={busy} onClick={() => fire(count, false)}>Send {count} in a row</button>
        <button className="btn ghost" disabled={busy} onClick={() => fire(count, true)}>Send {count} at once</button>
        <button className="btn ghost" onClick={() => setLog([])}>Clear</button>
      </div>

      <div className="legend">
        <span><span className="chip ok">200</span> {allowed}</span>
        <span><span className="chip bad">429</span> {blocked}</span>
      </div>

      <div className="log mono" style={{ marginTop: 12 }}>
        {log.length === 0 && <div className="empty" style={{ display: 'block' }}>Send a request to see responses</div>}
        {log.map((l) => (
          <div key={l.id}>
            <span className={`chip ${l.status === 200 ? 'ok' : l.status === 429 ? 'bad' : 'warn'}`}>{l.status || 'ERR'}</span>
            <span>remaining: {l.remaining ?? '-'}</span>
            {l.retry && <span>retry-after: {l.retry}s</span>}
            {l.degraded && <span className="chip warn">degraded</span>}
            <span className="note">{l.ms} ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}
