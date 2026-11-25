"use client";
import { useEffect, useState } from "react";
import { api } from "../components/api";

export default function Setup() {
  const [status, setStatus] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ t: "ok" | "err"; s: string } | null>(null);

  const refresh = () => api("/api/admin/setup").then(setStatus).catch((e) => setStatus({ error: e.message }));
  useEffect(() => { refresh(); }, []);

  async function act(action: "init" | "reset") {
    if (action === "reset" && !confirm("Reload the original dataset? Rows added in the app (daily entries, targets, app-created campaigns) are removed. Tasks are kept.")) return;
    setBusy(action); setMsg(null);
    try {
      const r = await api("/api/admin/setup", { method: "POST", json: { token, action } });
      setMsg({ t: "ok", s: r.action === "schema_upgraded" ? "Schema is up to date; data already loaded." : `Done: ${r.action.replace("_", " ")}. Loaded ${Object.values(r.loaded || {}).reduce((a: number, b: any) => a + Number(b), 0).toLocaleString("en-IN")} source rows.` });
      refresh();
    } catch (e) { setMsg({ t: "err", s: e instanceof Error ? e.message : String(e) }); }
    setBusy("");
  }

  return (
    <div className="stack narrow">
      <div className="card">
        <h1>Setup</h1>
        <p>One-time setup for a new deployment, and a reset button for testing.</p>
        {msg && <div className={`flash ${msg.t}`}>{msg.s}</div>}
        <h2>Database</h2>
        {!status ? <p>Checking…</p> : status.error ? <p className="alert-text">Cannot reach the database: {status.error}</p> : (
          <ul className="small">
            <li>Tables: {status.schema ? "✓ created" : "✗ not created yet"}</li>
            <li>Metric functions: {status.functions ? "✓ installed" : "✗ missing"}</li>
            {status.schema && Object.entries(status.rows || {}).map(([k, v]) => <li key={k}>{k}: {Number(v).toLocaleString("en-IN")} rows</li>)}
          </ul>
        )}
        <label className="form">Admin token (the ADMIN_TOKEN environment variable; only needed to reset)
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" />
        </label>
        <div className="row-btns">
          <button className="primary" disabled={!!busy} onClick={() => act("init")}>{busy === "init" ? "Working…" : "Initialise database"}</button>
          <button className="ghost danger" disabled={!token || !!busy} onClick={() => act("reset")}>{busy === "reset" ? "Working…" : "Reset to original data"}</button>
        </div>
        <h2>AI analyst</h2>
        <button className="ghost" onClick={() => { setHealth({ checking: true }); api("/api/health?ai=1").then(setHealth).catch((e) => setHealth({ error: e.message })); }}>Test AI connection</button>
        {health && (
          <ul className="small">
            {health.checking && <li>Checking…</li>}
            {health.error && <li className="alert-text">{health.error}</li>}
            {"ai_key_set" in health && <li>GEMINI_API_KEY: {health.ai_key_set ? "✓ set" : "✗ not set"} · model: <code>{health.model}</code></li>}
            {health.ai && <li>{health.ai.ok ? `✓ Gemini replied: "${health.ai.reply}"` : <span className="alert-text">✗ {health.ai.error}</span>}</li>}
          </ul>
        )}
        <p className="small muted">When everything shows ✓, open the <a href="/">Overview</a>.</p>
      </div>
    </div>
  );
}
