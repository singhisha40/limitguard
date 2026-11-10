import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import StatsChart from './StatsChart.jsx';

export default function Dashboard() {
  const [series, setSeries] = useState([]);
  const [bucketMs, setBucketMs] = useState(10000);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const loadStats = async () => {
      const res = await api.stats(30).catch(() => null);
      if (!alive) return;
      if (res?.ok) {
        setSeries(res.body.series);
        setBucketMs(res.body.bucketMs);
        setError('');
      } else {
        setError('Cannot load stats. Is the server running and is Redis connected?');
      }
    };
    const loadEvents = async () => {
      const res = await api.events(12).catch(() => null);
      if (alive && res?.ok) setEvents(res.body);
    };
    loadStats();
    loadEvents();
    const a = setInterval(loadStats, 2000);
    const b = setInterval(loadEvents, 5000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const allowed = series.reduce((n, b) => n + b.allowed, 0);
  const blocked = series.reduce((n, b) => n + b.blocked, 0);
  const total = allowed + blocked;
  const rate = total ? Math.round((blocked / total) * 100) : 0;
  const minutes = Math.round((series.length * bucketMs) / 60000);

  const perRule = {};
  series.forEach((b) =>
    Object.entries(b.byRule).forEach(([rule, v]) => {
      perRule[rule] = perRule[rule] || { allowed: 0, blocked: 0 };
      perRule[rule].allowed += v.allowed;
      perRule[rule].blocked += v.blocked;
    })
  );

  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="label">Requests (last {minutes || 5} min)</div><div className="value">{total}</div></div>
        <div className="kpi"><div className="label">Allowed</div><div className="value" style={{ color: 'var(--ok)' }}>{allowed}</div></div>
        <div className="kpi"><div className="label">Blocked</div><div className="value" style={{ color: 'var(--bad)' }}>{blocked}</div></div>
        <div className="kpi"><div className="label">Block rate</div><div className="value">{rate}%</div></div>
      </div>

      <div className="card">
        <h2>Traffic</h2>
        <p className="sub">Counters are kept in Redis (one HINCRBY per request) and bucketed every {bucketMs / 1000}s. Use the Playground tab to generate traffic.</p>
        {error ? <div className="error">{error}</div> : <StatsChart series={series} />}
      </div>

      <div className="grid two">
        <div className="card">
          <h2>By rule</h2>
          {Object.keys(perRule).length === 0 ? (
            <div className="empty">No traffic yet</div>
          ) : (
            <table>
              <thead><tr><th>Rule</th><th>Allowed</th><th>Blocked</th></tr></thead>
              <tbody>
                {Object.entries(perRule).map(([rule, v]) => (
                  <tr key={rule}><td className="mono">{rule}</td><td>{v.allowed}</td><td>{v.blocked}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Recent blocks</h2>
          {events.length === 0 ? (
            <div className="empty">Nothing logged (needs MongoDB)</div>
          ) : (
            <div className="scroll">
              <table>
                <thead><tr><th>Time</th><th>Rule</th><th>Who</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e._id}>
                      <td>{new Date(e.at).toLocaleTimeString()}</td>
                      <td className="mono">{e.rule}</td>
                      <td className="mono">{e.identifier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
