"use client";
import { useEffect, useState } from "react";
import { useApp } from "../components/AppShell";
import { api } from "../components/api";
import { n0, inr, dateTime, longDate } from "@/lib/format";

export default function Settings() {
  const { asOf, version, bump } = useApp();
  const [targets, setTargets] = useState<any[]>([]);
  const [assump, setAssump] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [log, setLog] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; s: string } | null>(null);
  const [nt, setNt] = useState<any>({ target_version: "", effective_date: "", identified_external_people_goal: "", registration_goal: "", unique_external_visitors_goal: "", marketing_budget_inr: "" });

  useEffect(() => {
    api("/api/targets").then(setTargets).catch((e) => setMsg({ t: "err", s: e.message }));
    api("/api/assumptions").then(setAssump).catch(() => {});
    api("/api/activity").then(setLog).catch(() => {});
  }, [version]);
  useEffect(() => {
    const last = targets[targets.length - 1];
    if (last) setNt((x: any) => ({ ...x, effective_date: x.effective_date || asOf, identified_external_people_goal: last.identified_external_people_goal, registration_goal: last.registration_goal, unique_external_visitors_goal: last.unique_external_visitors_goal, marketing_budget_inr: last.marketing_budget_inr }));
  }, [targets, asOf]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); setMsg({ t: "ok", s: ok }); bump(); } catch (e) { setMsg({ t: "err", s: e instanceof Error ? e.message : String(e) }); }
  }

  return (
    <div className="stack">
      {msg && <div className={`flash ${msg.t}`}>{msg.s}</div>}
      <div className="card">
        <h2>Target versions</h2>
        <p className="small muted">Targets change over time. Each date uses the latest version effective on or before it, so adding a version never rewrites earlier snapshots.</p>
        <table className="tbl compact">
          <thead><tr><th>Version</th><th>Effective</th><th className="r">Identified people</th><th className="r">Registrations</th><th className="r">Unique visitors</th><th className="r">Budget</th><th>Source</th></tr></thead>
          <tbody>{targets.map((t) => (
            <tr key={t._row}><td><b>{t.target_version}</b></td><td>{dateTime(t.effective_at)}</td><td className="r">{n0(t.identified_external_people_goal)}</td>
              <td className="r">{n0(t.registration_goal)}</td><td className="r">{n0(t.unique_external_visitors_goal)}</td><td className="r">{inr(t.marketing_budget_inr)}</td><td className="small">{t.origin === "app" ? "added in app" : "dataset"}</td></tr>
          ))}</tbody>
        </table>
        <form className="form" onSubmit={(e) => { e.preventDefault(); run(() => api("/api/targets", { method: "POST", json: nt }), "New target version saved"); }}>
          <h3>Add a new version</h3>
          <div className="form-grid wide">
            <label>Name<input required value={nt.target_version} onChange={(e) => setNt({ ...nt, target_version: e.target.value })} placeholder="e.g. April stretch plan" /></label>
            <label>Effective from<input type="date" required value={nt.effective_date} onChange={(e) => setNt({ ...nt, effective_date: e.target.value })} /></label>
            <label>Identified people<input inputMode="numeric" value={nt.identified_external_people_goal} onChange={(e) => setNt({ ...nt, identified_external_people_goal: e.target.value })} /></label>
            <label>Registrations<input inputMode="numeric" value={nt.registration_goal} onChange={(e) => setNt({ ...nt, registration_goal: e.target.value })} /></label>
            <label>Unique visitors<input inputMode="numeric" value={nt.unique_external_visitors_goal} onChange={(e) => setNt({ ...nt, unique_external_visitors_goal: e.target.value })} /></label>
            <label>Budget ₹<input inputMode="numeric" value={nt.marketing_budget_inr} onChange={(e) => setNt({ ...nt, marketing_budget_inr: e.target.value })} /></label>
          </div>
          <button className="primary">Save version</button>
        </form>
      </div>

      <div className="card">
        <h2>Assumptions</h2>
        <p className="small muted">These drive projections and scale/fix/stop signals. They are judgement, not data, and are shown as such everywhere, including in the AI analyst&apos;s answers.</p>
        <table className="tbl compact">
          <thead><tr><th>Assumption</th><th className="r">Value</th><th>Unit</th><th>Basis</th><th></th></tr></thead>
          <tbody>{assump.map((a) => (
            <tr key={a.key}>
              <td><b>{a.key}</b><div className="small muted">{a.description}</div></td>
              <td className="r"><input className="num-in" value={edits[a.key] ?? String(a.value)} onChange={(e) => setEdits({ ...edits, [a.key]: e.target.value })} /></td>
              <td className="small">{a.unit}</td><td className="small">{a.basis}</td>
              <td>{edits[a.key] !== undefined && edits[a.key] !== String(a.value) &&
                <button className="small-btn" onClick={() => run(async () => { await api(`/api/assumptions/${a.key}`, { method: "PATCH", json: { value: edits[a.key] } }); setEdits((x) => { const y = { ...x }; delete y[a.key]; return y; }); }, `${a.key} updated`)}>Save</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="card">
        <h2>Data</h2>
        <p className="small">The original RISA dataset is kept intact. Rows added in the app are tagged &ldquo;added in app&rdquo;. To reload the original data (for example after testing), use <a href="/setup">Setup → Reset to original data</a>.</p>
        <p className="small muted">Selected date: {longDate(asOf)}.</p>
      </div>

      <div className="card">
        <h2>Activity log</h2>
        <p className="small muted">Every change made in the app or confirmed from the AI analyst.</p>
        <table className="tbl compact">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Details</th></tr></thead>
          <tbody>{log.map((l) => (
            <tr key={l.id}><td className="nowrap">{dateTime(l.at)}</td><td>{l.actor === "ai_copilot" ? <span className="badge ai">AI (confirmed)</span> : l.actor}</td>
              <td>{l.action} {l.entity}</td><td className="small">{l.entity_id}</td>
              <td className="small mono">{JSON.stringify(l.details).slice(0, 160)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
