import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = { name: '', algorithm: 'token_bucket', limit: 10, windowSec: 10, keyBy: 'ip', enabled: true, description: '' };

const ALGO_LABEL = {
  token_bucket: 'Token bucket',
  sliding_window: 'Sliding window',
  fixed_window: 'Fixed window',
};

export default function RulesPanel() {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await api.rules().catch(() => null);
    if (res?.ok) setRules(res.body);
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const payload = { ...form, limit: Number(form.limit), windowSec: Number(form.windowSec) };
    const res = editing ? await api.updateRule(editing, payload) : await api.createRule(payload);
    if (!res.ok) return setError(res.body?.error || 'Could not save rule');
    setForm(EMPTY);
    setEditing(null);
    load();
  };

  const edit = (r) => {
    setEditing(r.name);
    setForm({ ...EMPTY, ...r });
    setError('');
  };

  const toggle = async (r) => {
    const res = await api.updateRule(r.name, { enabled: !r.enabled });
    if (!res.ok) return setError(res.body?.error || 'Could not update');
    load();
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    const res = await api.deleteRule(r.name);
    if (!res.ok) return setError(res.body?.error || 'Could not delete');
    load();
  };

  return (
    <>
      <div className="card">
        <h2>Rules</h2>
        <p className="sub">Stored in MongoDB, cached in memory by the server (refreshed every few seconds, instantly after an edit here).</p>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Algorithm</th><th>Limit</th><th>Window</th><th>Key</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.name}>
                  <td className="mono">{r.name}</td>
                  <td>{ALGO_LABEL[r.algorithm]}</td>
                  <td>{r.limit}</td>
                  <td>{r.windowSec}s</td>
                  <td>{r.keyBy}</td>
                  <td><span className={`chip ${r.enabled ? 'ok' : 'warn'}`}>{r.enabled ? 'enabled' : 'disabled'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost small" onClick={() => edit(r)}>Edit</button>{' '}
                    <button className="btn ghost small" onClick={() => toggle(r)}>{r.enabled ? 'Disable' : 'Enable'}</button>{' '}
                    <button className="btn danger small" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <h2>{editing ? `Edit "${editing}"` : 'New rule'}</h2>
        <p className="sub">
          Token bucket: limit = burst size, refills limit / window tokens per second. Sliding and fixed window: limit requests per window.
        </p>
        <div className="row">
          <label className="field">Name
            <input required pattern="[a-z0-9_-]{1,40}" disabled={!!editing} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="signup" style={{ width: 140 }} />
          </label>
          <label className="field">Algorithm
            <select value={form.algorithm} onChange={(e) => set('algorithm', e.target.value)}>
              {Object.entries(ALGO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">Limit
            <input type="number" min="1" required value={form.limit} onChange={(e) => set('limit', e.target.value)} style={{ width: 90 }} />
          </label>
          <label className="field">Window (s)
            <input type="number" min="1" required value={form.windowSec} onChange={(e) => set('windowSec', e.target.value)} style={{ width: 100 }} />
          </label>
          <label className="field">Key by
            <select value={form.keyBy} onChange={(e) => set('keyBy', e.target.value)}>
              <option value="ip">IP address</option>
              <option value="apiKey">X-API-Key header</option>
            </select>
          </label>
          <button className="btn" type="submit">{editing ? 'Save changes' : 'Create rule'}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>}
        </div>
        {error && <div className="error">{error}</div>}
      </form>
    </>
  );
}
