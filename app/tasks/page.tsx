"use client";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../components/AppShell";
import { api } from "../components/api";
import { shortDate } from "@/lib/format";

const COLS = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];
const blank = { title: "", description: "", campaign_id: "", owner_name: "", due_date: "", priority: "medium", evidence: "" };

export default function Tasks() {
  const { asOf, version, bump } = useApp();
  const [tasks, setTasks] = useState<any[]>([]);
  const [camps, setCamps] = useState<any[]>([]);
  const [f, setF] = useState<any>(blank);
  const [edit, setEdit] = useState<any>(null);
  const [filter, setFilter] = useState({ owner: "", campaign_id: "" });
  const [msg, setMsg] = useState<{ t: "ok" | "err"; s: string } | null>(null);

  useEffect(() => {
    api("/api/tasks").then(setTasks).catch((e) => setMsg({ t: "err", s: e.message }));
    api("/api/campaigns").then(setCamps).catch(() => {});
  }, [version]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); setMsg({ t: "ok", s: ok }); bump(); } catch (e) { setMsg({ t: "err", s: e instanceof Error ? e.message : String(e) }); }
  }
  const shown = useMemo(() => tasks.filter((t) =>
    (!filter.owner || (t.owner_name || "").toLowerCase().includes(filter.owner.toLowerCase())) &&
    (!filter.campaign_id || t.campaign_id === filter.campaign_id)), [tasks, filter]);
  const owners = Array.from(new Set(tasks.map((t) => t.owner_name).filter(Boolean)));
  const overdue = (t: any) => t.due_date && t.status !== "done" && t.due_date < asOf;

  return (
    <div className="stack">
      {msg && <div className={`flash ${msg.t}`}>{msg.s}</div>}
      <form className="card form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/tasks", { method: "POST", json: f }); setF(blank); }, "Task created"); }}>
        <h2>New task</h2>
        <div className="form-grid wide">
          <label className="span2">Title<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Promote the waitlist after every cancellation" /></label>
          <label>Campaign<select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">— none —</option>{camps.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} {c.campaign_name}</option>)}</select></label>
          <label>Owner<input value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} list="owners" /></label>
          <label>Due<input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
          <label>Priority<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option>low</option><option>medium</option><option>high</option></select></label>
          <label className="span2">Description<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label className="span2">Evidence (why)<input value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="The numbers behind this task" /></label>
        </div>
        <datalist id="owners">{owners.map((o) => <option key={o} value={o} />)}{camps.map((c) => c.owner_name).filter(Boolean).map((o, i) => <option key={"c" + i} value={o} />)}</datalist>
        <button className="primary">Create task</button>
      </form>

      <div className="filters">
        <input placeholder="Filter by owner" value={filter.owner} onChange={(e) => setFilter({ ...filter, owner: e.target.value })} />
        <select value={filter.campaign_id} onChange={(e) => setFilter({ ...filter, campaign_id: e.target.value })}>
          <option value="">All campaigns</option>{camps.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
        </select>
        <span className="small muted">Overdue is judged against the selected as-of date ({shortDate(asOf)}).</span>
      </div>

      <div className="board">
        {COLS.map((col) => (
          <div key={col.key} className="board-col">
            <div className="board-head">{col.label} <span className="muted">{shown.filter((t) => t.status === col.key).length}</span></div>
            {shown.filter((t) => t.status === col.key).map((t) => (
              <div key={t.id} className={`task-card pr-${t.priority} ${overdue(t) ? "overdue" : ""}`}>
                {edit?.id === t.id ? (
                  <form className="form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { title: edit.title, owner_name: edit.owner_name, due_date: edit.due_date || null, priority: edit.priority, description: edit.description } }); setEdit(null); }, "Task updated"); }}>
                    <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
                    <input value={edit.owner_name || ""} placeholder="Owner" onChange={(e) => setEdit({ ...edit, owner_name: e.target.value })} />
                    <input type="date" value={edit.due_date || ""} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} />
                    <select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}><option>low</option><option>medium</option><option>high</option></select>
                    <textarea rows={2} value={edit.description || ""} placeholder="Description" onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                    <div className="row-btns"><button className="primary">Save</button><button type="button" className="ghost" onClick={() => setEdit(null)}>Cancel</button></div>
                  </form>
                ) : (
                  <>
                    <div className="task-title">{t.title}</div>
                    <div className="small muted">
                      {t.campaign_name ? `${t.campaign_name} · ` : ""}{t.owner_name || "unassigned"}
                      {t.due_date ? <> · <span className={overdue(t) ? "alert-text" : ""}>due {shortDate(t.due_date)}{overdue(t) ? " (overdue)" : ""}</span></> : ""}
                    </div>
                    <div className="task-tags"><span className={`badge pr-${t.priority}`}>{t.priority}</span>{t.created_by === "ai_copilot" && <span className="badge ai">from AI analyst</span>}</div>
                    {t.description && <div className="small">{t.description}</div>}
                    {t.evidence && <details className="small"><summary>Evidence</summary>{t.evidence}</details>}
                    <div className="task-actions">
                      <select value={t.status} onChange={(e) => run(() => api(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: e.target.value } }), "Status updated")}>
                        {COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                      <button className="link" onClick={() => setEdit(t)}>edit</button>
                      <button className="link danger" onClick={() => { if (confirm("Delete this task?")) run(() => api(`/api/tasks/${t.id}`, { method: "DELETE" }), "Task deleted"); }}>delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
