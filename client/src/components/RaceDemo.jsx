import React, { useState } from 'react';
import { api } from '../api.js';

function Bar({ label, value, max, limit, color }) {
  return (
    <div className="bar-row">
      <div>{label}</div>
      <div className="bar-track" aria-hidden="true">
        <div className="bar-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
        <div className="limit-line" style={{ left: `${(limit / max) * 100}%` }} title={`limit ${limit}`} />
      </div>
      <div className="mono">{value}</div>
    </div>
  );
}

export default function RaceDemo() {
  const [limit, setLimit] = useState(100);
  const [requests, setRequests] = useState(1000);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    const res = await api.race(limit, Math.max(limit, requests)).catch(() => null);
    if (res?.ok) setResult(res.body);
    else setError('Request failed. Is Redis running?');
    setBusy(false);
  };

  return (
    <div className="card">
      <h2>Race condition demo</h2>
      <p className="sub">
        The same burst of concurrent requests hits two limiters. The naive one reads the counter, decides in JavaScript, then
        writes. The atomic one does all three steps inside a single Redis Lua script. The black line is the configured limit.
      </p>
      <div className="row">
        <label className="field">Limit
          <input type="number" min="1" max="1000" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1)} style={{ width: 100 }} />
        </label>
        <label className="field">Concurrent requests
          <input type="number" min="1" max="3000" value={requests} onChange={(e) => setRequests(Number(e.target.value) || 1)} style={{ width: 130 }} />
        </label>
        <button className="btn" onClick={run} disabled={busy}>{busy ? 'Running...' : 'Run race'}</button>
      </div>
      {error && <div className="error">{error}</div>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <Bar label="Naive (GET then INCR)" value={result.naive.allowed} max={result.requests} limit={result.limit} color="var(--bad)" />
          <Bar label="Atomic (Lua script)" value={result.atomic.allowed} max={result.requests} limit={result.limit} color="var(--ok)" />
          <p className="note">
            Out of {result.requests} requests with a limit of {result.limit}: the naive limiter let{' '}
            <strong>{result.naive.allowed}</strong> through ({result.naive.overshoot} too many), the atomic limiter let{' '}
            <strong>{result.atomic.allowed}</strong> through ({result.atomic.overshoot} too many).
          </p>
        </div>
      )}
    </div>
  );
}
