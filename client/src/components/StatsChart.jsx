import React from 'react';

const W = 800;
const H = 220;
const PAD = { top: 10, right: 10, bottom: 26, left: 36 };

function niceMax(n) {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 5, 10].find((m) => m * pow >= n);
  return step * pow;
}

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Stacked bar chart: allowed (bottom) + blocked (top) per time bucket. Plain SVG, no chart library. */
export default function StatsChart({ series }) {
  const max = niceMax(Math.max(0, ...series.map((b) => b.allowed + b.blocked)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, series.length);
  const barW = Math.max(2, slot * 0.7);
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(series.length / 6);

  const summary = `Requests per ${series.length} time buckets. Allowed ${series.reduce((n, b) => n + b.allowed, 0)}, blocked ${series.reduce((n, b) => n + b.blocked, 0)}.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {series.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const allowedH = (b.allowed / max) * innerH;
          const blockedH = (b.blocked / max) * innerH;
          return (
            <g key={b.t}>
              <title>{`${fmt(b.t)}  allowed ${b.allowed}, blocked ${b.blocked}`}</title>
              <rect x={x} y={y(b.allowed)} width={barW} height={allowedH} fill="var(--ok)" rx="1" />
              <rect x={x} y={y(b.allowed + b.blocked)} width={barW} height={blockedH} fill="var(--bad)" rx="1" />
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">
                  {fmt(b.t)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i style={{ background: 'var(--ok)' }} />Allowed</span>
        <span><i style={{ background: 'var(--bad)' }} />Blocked (429)</span>
      </div>
    </div>
  );
}
