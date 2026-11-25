"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppShell";
import { api } from "./api";
import { longDate } from "@/lib/format";

type Trace = { tool: string; args: Record<string, unknown>; ok: boolean; error?: string; rows?: number };
type Pending = { id: string; summary: string; kind: string; state?: "pending" | "confirmed" | "cancelled" | "failed"; note?: string };
type Msg = { role: "user" | "assistant"; content: string; trace?: Trace[]; pending?: Pending[]; asOf?: string; error?: boolean };

const STARTERS = [
  "How are we tracking against the visitor goal, and what is the projected gap?",
  "Which campaigns should we scale, fix or stop, and why?",
  "Where is the biggest drop-off in the funnel?",
  "What changed in the last 7 days compared with the 7 days before?",
  "Why did Paid Social look fine per registration but cost so much per visitor?",
  "What is the gender split of our attendees?",
];

const STORE = "cf-copilot-chat-v1";

/** Minimal, safe markdown: paragraphs, bullets, numbered lists and **bold**. Builds React nodes (no innerHTML). */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    const o = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b || o) {
      const ordered = !!o;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((b || o)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    out.push(h ? <p key={out.length} className="rich-h">{inline(h[1])}</p> : <p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="rich">{out}</div>;
}
function inline(s: string): React.ReactNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
      : p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code>
      : <span key={i}>{p}</span>);
}

function argText(a: Record<string, unknown>) {
  const e = Object.entries(a || {}).filter(([k]) => k !== "sql" && k !== "evidence" && k !== "description" && k !== "reason");
  return e.length ? e.map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(", ") : "";
}

export default function Copilot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { asOf, bump } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(STORE); if (s) setMsgs(JSON.parse(s)); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content, asOf }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await api("/api/chat", {
        method: "POST",
        json: { asOf, messages: next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })) },
      });
      setMsgs((m) => [...m, {
        role: "assistant", content: res.reply, trace: res.trace, asOf: res.asOf,
        pending: (res.pending || []).map((p: Pending) => ({ ...p, state: "pending" })),
      }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(mi: number, pi: number, decision: "confirm" | "cancel") {
    const p = msgs[mi].pending![pi];
    try {
      const r = await api(`/api/actions/${p.id}`, { method: "POST", json: { decision } });
      setMsgs((m) => m.map((msg, i) => i !== mi ? msg : {
        ...msg, pending: msg.pending!.map((x, j) => j !== pi ? x : { ...x, state: r.status, note: r.status === "confirmed" ? "Done — saved to the management tool." : "Cancelled. Nothing changed." }),
      }));
      if (r.status === "confirmed") bump();
    } catch (e) {
      setMsgs((m) => m.map((msg, i) => i !== mi ? msg : {
        ...msg, pending: msg.pending!.map((x, j) => j !== pi ? x : { ...x, state: "failed", note: e instanceof Error ? e.message : String(e) }),
      }));
    }
  }

  return (
    <aside className={open ? "copilot open" : "copilot"} aria-hidden={!open}>
      <div className="copilot-head">
        <div>
          <div className="copilot-title">AI Growth Analyst</div>
          <div className="copilot-sub">Answers from live campaign data as of {asOf ? longDate(asOf) : "…"}. Changes need your confirmation.</div>
        </div>
        <div className="copilot-actions">
          <button className="ghost" onClick={() => setMsgs([])} disabled={!msgs.length}>New chat</button>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <div className="copilot-body">
        {!msgs.length && (
          <div className="starters">
            <p>Try one of these, or ask your own:</p>
            {STARTERS.map((s) => <button key={s} className="starter" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.error ? " error" : ""}`}>
            {m.role === "user" ? <div className="bubble">{m.content}</div> : (
              <div className="bubble">
                <Rich text={m.content} />
                {!!m.pending?.length && m.pending.map((p, j) => (
                  <div key={p.id} className={`proposal ${p.state}`}>
                    <div className="proposal-label">{p.kind === "create_task" ? "Proposed task" : "Proposed campaign change"}</div>
                    <div className="proposal-text">{p.summary}</div>
                    {p.state === "pending" ? (
                      <div className="proposal-buttons">
                        <button className="primary" onClick={() => decide(i, j, "confirm")}>Confirm</button>
                        <button className="ghost" onClick={() => decide(i, j, "cancel")}>Cancel</button>
                      </div>
                    ) : <div className="proposal-note">{p.note}</div>}
                  </div>
                ))}
                {!!m.trace?.length && (
                  <details className="trace">
                    <summary>Data used: {m.trace.length} tool call{m.trace.length > 1 ? "s" : ""}{m.asOf ? ` · as of ${m.asOf}` : ""}</summary>
                    <ul>
                      {m.trace.map((t, k) => (
                        <li key={k} className={t.ok ? "" : "bad"}>
                          <code>{t.tool}</code>{argText(t.args) ? ` (${argText(t.args)})` : ""}
                          {t.rows !== undefined ? ` → ${t.rows} rows` : ""}{t.ok ? "" : ` → error: ${t.error}`}
                          {typeof t.args?.sql === "string" && <pre>{String(t.args.sql)}</pre>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="bubble thinking">Analysing the data…</div></div>}
        <div ref={endRef} />
      </div>
      <form className="copilot-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
                  placeholder="Ask about performance, bottlenecks, what to do next…"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <button className="primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
