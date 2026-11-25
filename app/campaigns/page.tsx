"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "../components/AppShell";
import { api } from "../components/api";
import { Funnel, SignalBadge } from "../components/Widgets";
import { DailyBars } from "../components/Charts";
import { n0, pct, inr, shortDate } from "@/lib/format";

const STATUSES = ["planned", "active", "paused", "stopped", "completed"];
const emptyEntry = { activity_date: "", impressions: "", clicks: "", landing_page_sessions: "", registration_starts: "", marketing_spend_inr: "", platform: "" };

export default function Campaigns() {
  const { asOf, version, bump } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [list, setList] = useState<any>(null);
  const [sel, setSel] = useState<string>(params.get("id") || "C01");
  const [det, setDet] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [entry, setEntry] = useState<any>(emptyEntry);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; s: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [nc, setNc] = useState<any>({ campaign_name: "", channel: "", owner_name: "", objective: "", planned_budget_inr: "", status: "planned" });
  const [task, setTask] = useState<any>({ title: "", owner_name: "", due_date: "", priority: "medium" });

  useEffect(() => { api(`/api/dashboard?asOf=${asOf}`).then(setList).catch((e) => setMsg({ t: "err", s: e.message })); }, [asOf, version]);
  useEffect(() => {
    if (!sel) return;
    api(`/api/campaigns/${sel}?asOf=${asOf}`).then((d) => {
      setDet(d);
      setForm({ status: d.campaign.status, planned_budget_inr: d.campaign.planned_budget_inr ?? "", owner_name: d.campaign.owner_name ?? "", notes: d.campaign.notes ?? "" });
      setEntry({ ...emptyEntry, activity_date: asOf });
      setCorrecting(null);
      setTask((t: any) => ({ ...t, owner_name: d.campaign.owner_name ?? "" }));
    }).catch((e) => setMsg({ t: "err", s: e.message }));
  }, [sel, asOf, version]);

  function pick(id: string) {
    setSel(id); setMsg(null);
    const sp = new URLSearchParams(params.toString()); sp.set("id", id);
    router.replace(`/campaigns?${sp}`, { scroll: false });
  }
  async function run(fn: () => Promise<unknown>, okMsg: string) {
    try { await fn(); setMsg({ t: "ok", s: okMsg }); bump(); } catch (e) { setMsg({ t: "err", s: e instanceof Error ? e.message : String(e) }); }
  }

  const sig = new Map((list?.signals || []).map((s: any) => [s.campaign_id, s]));
  const camps = (list?.campaigns || []).filter((c: any) => c.campaign_id);

  return (
    <div className="split">
      <aside className="card list-pane">
        <div className="card-head"><h2>Campaigns</h2><button className="small-btn" onClick={() => setShowNew((s) => !s)}>+ New</button></div>
        {showNew && (
          <form className="mini-form" onSubmit={(e) => { e.preventDefault(); run(async () => { const c = await api("/api/campaigns", { method: "POST", json: nc }); setShowNew(false); setSel(c.campaign_id); }, "Campaign created"); }}>
            <input required placeholder="Name, e.g. Squad Pass referrals" value={nc.campaign_name} onChange={(e) => setNc({ ...nc, campaign_name: e.target.value })} />
            <input required placeholder="Channel, e.g. referrals" value={nc.channel} onChange={(e) => setNc({ ...nc, channel: e.target.value })} />
            <input placeholder="Owner" value={nc.owner_name} onChange={(e) => setNc({ ...nc, owner_name: e.target.value })} />
            <input placeholder="Objective" value={nc.objective} onChange={(e) => setNc({ ...nc, objective: e.target.value })} />
            <input placeholder="Planned budget ₹" inputMode="numeric" value={nc.planned_budget_inr} onChange={(e) => setNc({ ...nc, planned_budget_inr: e.target.value })} />
            <button className="primary">Create</button>
          </form>
        )}
        {camps.map((c: any) => (
          <button key={c.campaign_id} className={`list-item ${sel === c.campaign_id ? "sel" : ""}`} onClick={() => pick(c.campaign_id)}>
            <div className="li-top"><b>{c.campaign_name}</b><SignalBadge signal={(sig.get(c.campaign_id) as any)?.signal} /></div>
            <div className="small muted">{c.campaign_id} · {c.owner_name || "no owner"} · <span className={`st-text st-${c.status}`}>{c.status}</span></div>
            <div className="small">{n0(c.registered_people)} reg · {n0(c.visitors)} visitors · {inr(c.spend_inr)}</div>
          </button>
        ))}
      </aside>

      <section className="stack detail-pane">
        {msg && <div className={`flash ${msg.t}`}>{msg.s}</div>}
        {!det ? <div className="loading">Loading…</div> : (() => {
          const c = det.campaign, p = det.perf || {}, s: any = sig.get(c.campaign_id);
          return (
            <>
              <div className="card">
                <div className="card-head">
                  <div><h1>{c.campaign_name} <span className="muted">· {c.campaign_id}</span></h1>
                    <p className="muted small">{c.channel} · {c.target_audience || "—"}<br />{c.objective}</p></div>
                  <SignalBadge signal={s?.signal} />
                </div>
                {s && <p className="small"><b>Why:</b> {s.reason}</p>}
                <div className="grid kpis small-kpis">
                  <div className="mini"><span>Spend</span><b>{inr(p.spend_inr)}</b><i>{pct(p.spend_share)} of total</i></div>
                  <div className="mini"><span>Registered</span><b>{n0(p.registered_people)}</b><i>{inr(p.cost_per_registration)} each</i></div>
                  <div className="mini"><span>Confirmed</span><b>{n0(p.confirmed_people)}</b><i>cancel rate {pct(p.cancel_rate)}</i></div>
                  <div className="mini"><span>Verified visitors</span><b>{n0(p.visitors)}</b><i>{p.visitors ? `${inr(p.cost_per_visitor)} each` : "after the fest"}</i></div>
                  <div className="mini"><span>Show rate</span><b>{list?.overview?.event_phase === "pre-event" ? "—" : pct(p.registration_to_visit)}</b><i>registered → attended</i></div>
                  <div className="mini"><span>Opt-out rate</span><b>{pct(p.opt_out_rate)}</b><i>{n0(p.opt_out_people)} people</i></div>
                </div>
              </div>

              <div className="grid two">
                <form className="card form" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/campaigns/${c.campaign_id}`, { method: "PATCH", json: form }), "Campaign saved"); }}>
                  <h2>Manage</h2>
                  <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label>Planned budget (₹)<input inputMode="numeric" value={form.planned_budget_inr} onChange={(e) => setForm({ ...form, planned_budget_inr: e.target.value })} placeholder="not allocated" /></label>
                  <label>Owner<input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></label>
                  <label>Notes<textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
                  <button className="primary">Save campaign</button>
                  {p.spend_inr !== undefined && form.planned_budget_inr !== "" && <p className="small muted">Spent {inr(p.spend_inr)} of planned {inr(form.planned_budget_inr)} ({pct(p.spend_inr / Number(form.planned_budget_inr || 1), 0)}).</p>}
                </form>
                <div className="card">
                  <h2>Funnel</h2>
                  <Funnel rows={det.funnel} preEvent={list?.overview?.event_phase === "pre-event"} />
                </div>
              </div>

              <div className="card">
                <h2>Daily spend and registrations</h2>
                <DailyBars daily={det.daily.filter((x: any) => x.spend_inr || x.new_registrations)} />
              </div>

              <div className="grid two">
                <form className="card form" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/campaigns/${c.campaign_id}/daily`, { method: "POST", json: { ...entry, activity_id: correcting || undefined } }), correcting ? "Correction saved: analytics now use the corrected numbers" : "Daily entry added: analytics updated"); }}>
                  <h2>{correcting ? `Correct ${correcting}` : "Add daily marketing data"}</h2>
                  <p className="small muted">{correcting ? "Saves a new version of this row; the original stays in the audit trail." : "New rows count in every metric from their date onward."}</p>
                  <div className="form-grid">
                    <label>Date<input type="date" required value={entry.activity_date} onChange={(e) => setEntry({ ...entry, activity_date: e.target.value })} /></label>
                    <label>Spend ₹ (credit = negative)<input inputMode="numeric" value={entry.marketing_spend_inr} onChange={(e) => setEntry({ ...entry, marketing_spend_inr: e.target.value })} /></label>
                    <label>Impressions<input inputMode="numeric" value={entry.impressions} onChange={(e) => setEntry({ ...entry, impressions: e.target.value })} /></label>
                    <label>Clicks<input inputMode="numeric" value={entry.clicks} onChange={(e) => setEntry({ ...entry, clicks: e.target.value })} /></label>
                    <label>Landing sessions<input inputMode="numeric" value={entry.landing_page_sessions} onChange={(e) => setEntry({ ...entry, landing_page_sessions: e.target.value })} /></label>
                    <label>Form starts<input inputMode="numeric" value={entry.registration_starts} onChange={(e) => setEntry({ ...entry, registration_starts: e.target.value })} /></label>
                  </div>
                  <div className="row-btns">
                    <button className="primary">{correcting ? "Save correction" : "Add entry"}</button>
                    {correcting && <button type="button" className="ghost" onClick={() => { setCorrecting(null); setEntry({ ...emptyEntry, activity_date: asOf }); }}>Cancel</button>}
                  </div>
                </form>
                <div className="card">
                  <h2>Tasks for this campaign</h2>
                  <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/tasks", { method: "POST", json: { ...task, campaign_id: c.campaign_id } }); setTask({ ...task, title: "" }); }, "Task added"); }}>
                    <input required placeholder="New task" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
                    <input placeholder="Owner" value={task.owner_name} onChange={(e) => setTask({ ...task, owner_name: e.target.value })} />
                    <input type="date" value={task.due_date} onChange={(e) => setTask({ ...task, due_date: e.target.value })} />
                    <button className="primary">Add</button>
                  </form>
                  <ul className="task-list">
                    {det.tasks.map((t: any) => (
                      <li key={t.id}><span className={`badge ts-${t.status}`}>{t.status.replace("_", " ")}</span> {t.title}
                        <span className="small muted"> · {t.owner_name || "unassigned"}{t.due_date ? ` · due ${shortDate(t.due_date)}` : ""}{t.created_by === "ai_copilot" ? " · from AI" : ""}</span></li>
                    ))}
                    {!det.tasks.length && <li className="muted small">No tasks yet.</li>}
                  </ul>
                </div>
              </div>

              <div className="card">
                <h2>Daily data rows <span className="muted small">(all dates, latest 60, de-duplicated; edits keep the original in the audit trail)</span></h2>
                <div className="tbl-wrap">
                  <table className="tbl compact">
                    <thead><tr><th>Date</th><th>Activity</th><th className="r">Impr.</th><th className="r">Clicks</th><th className="r">Sessions</th><th className="r">Form starts</th><th className="r">Spend</th><th>Source</th><th></th></tr></thead>
                    <tbody>
                      {det.entries.map((r: any) => (
                        <tr key={r._row}>
                          <td>{shortDate(r.activity_date)}</td><td className="small">{r.activity_id}</td>
                          <td className="r">{n0(r.impressions)}</td><td className="r">{n0(r.clicks)}</td><td className="r">{n0(r.landing_page_sessions)}</td>
                          <td className="r">{n0(r.registration_starts)}</td><td className={`r ${r.marketing_spend_inr < 0 ? "neg" : ""}`}>{inr(r.marketing_spend_inr)}</td>
                          <td className="small">{r.origin === "app" ? "added in app" : r.platform}</td>
                          <td className="r nowrap">
                            <button className="link" onClick={() => { setCorrecting(r.activity_id); setEntry({ activity_date: r.activity_date, impressions: r.impressions, clicks: r.clicks, landing_page_sessions: r.landing_page_sessions, registration_starts: r.registration_starts, marketing_spend_inr: r.marketing_spend_inr, platform: r.platform }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>correct</button>
                            {r.origin === "app" && <button className="link danger" onClick={() => run(() => api(`/api/daily/${r._row}`, { method: "DELETE" }), "Row deleted")}>delete</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          );
        })()}
      </section>
    </div>
  );
}
