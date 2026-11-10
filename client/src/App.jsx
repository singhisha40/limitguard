import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Dashboard from './components/Dashboard.jsx';
import Playground from './components/Playground.jsx';
import RaceDemo from './components/RaceDemo.jsx';
import RulesPanel from './components/RulesPanel.jsx';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['playground', 'Playground'],
  ['race', 'Race demo'],
  ['rules', 'Rules'],
];

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const check = async () => {
      const res = await api.health().catch(() => null);
      setHealth(res ? res.body : null);
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>LimitGuard</h1>
          <p>Distributed rate limiter service: Express, Redis Lua scripts, MongoDB rules, React dashboard</p>
        </div>
        <div className="status" aria-label="Service status">
          <span className="pill"><span className={`dot ${health?.redis ? 'on' : ''}`} />Redis</span>
          <span className="pill"><span className={`dot ${health?.mongo ? 'on' : ''}`} />MongoDB</span>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'playground' && <Playground />}
      {tab === 'race' && <RaceDemo />}
      {tab === 'rules' && <RulesPanel />}
    </div>
  );
}
