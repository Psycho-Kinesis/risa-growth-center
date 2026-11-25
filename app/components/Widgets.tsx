"use client";
import { n0, pct, inr } from "@/lib/format";

export function Kpi({ label, value, goal, goalLabel, sub, fmt = n0, tone }: {
  label: string; value: number | null | undefined; goal?: number | null; goalLabel?: string; sub?: string;
  fmt?: (v: unknown) => string; tone?: "good" | "watch" | "alert";
}) {
  const p = goal ? Math.min((Number(value) || 0) / goal, 1.25) : null;
  const t = tone ?? (p === null ? undefined : p >= 1 ? "good" : p >= 0.9 ? "watch" : "alert");
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{fmt(value)}</div>
      {goal ? (
        <>
          <div className="bar"><div className={`bar-fill ${t}`} style={{ width: `${Math.min(p! * 80, 100)}%` }} /><div className="bar-goal" style={{ left: "80%" }} /></div>
          <div className="kpi-sub">{pct(Number(value) / goal, 0)} of {goalLabel ?? "goal"} {fmt(goal)}</div>
        </>
      ) : <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`dot ${status}`} title={status} />;
}

export function SignalBadge({ signal }: { signal?: string }) {
  if (!signal) return null;
  return <span className={`badge sig-${signal.replace(/\s/g, "-")}`}>{signal}</span>;
}

export function Funnel({ rows, preEvent = false }: { rows: any[]; preEvent?: boolean }) {
  const anon = rows.filter((r) => r.stage_order <= 3);
  const people = rows.filter((r) => r.stage_order >= 4);
  const top = Math.max(...people.map((r) => Number(r.value) || 0), 1);
  const judged = people.slice(1).filter((r) => !(preEvent && r.stage_order === 7));
  const worst = judged.reduce((w: any, r: any) => (!w || (r.conversion_from_previous ?? 1) < (w.conversion_from_previous ?? 1) ? r : w), null);
  return (
    <div className="funnel">
      <div className="funnel-anon">
        {anon.map((r) => (
          <div key={r.stage}><span className="muted">{r.stage}</span> <b>{n0(r.value)}</b>
            {r.conversion_from_previous !== null && <span className="muted"> ({pct(r.conversion_from_previous)})</span>}</div>
        ))}
        <div className="muted small">Anonymous event counts, not people.</div>
      </div>
      {people.map((r) => (
        <div key={r.stage} className="funnel-row">
          <div className="funnel-label">{r.stage}</div>
          <div className="funnel-bar-wrap">
            <div className="funnel-bar" style={{ width: `${(Number(r.value) / top) * 100}%` }} />
            <span className="funnel-num">{n0(r.value)}</span>
          </div>
          <div className={`funnel-conv ${worst && worst.stage === r.stage ? "worst" : ""}`}>
            {preEvent && r.stage_order === 7 ? "after the fest"
              : r.stage_order > 4 && r.conversion_from_previous !== null ? `${pct(r.conversion_from_previous)} of previous` : ""}
          </div>
        </div>
      ))}
      {worst && <div className="small muted">Biggest drop among people: <b>{worst.stage}</b> ({pct(worst.conversion_from_previous)} of the previous stage).</div>}
    </div>
  );
}

export function Indicators({ rows }: { rows: any[] }) {
  const fmt = (r: any, v: any) => (v === null || v === undefined ? "—" : r.unit === "ratio" ? pct(v) : n0(v));
  return (
    <table className="tbl compact">
      <thead><tr><th></th><th>Indicator</th><th className="r">Now</th><th className="r">Target</th><th>Bet</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.indicator} title={r.note}>
            <td><StatusDot status={r.status} /></td>
            <td>{r.indicator}<div className="small muted">{r.note}</div></td>
            <td className="r"><b>{fmt(r, r.value)}</b></td>
            <td className="r muted">{r.target === null ? `≤ ${fmt(r, r.alert_level)}` : fmt(r, r.target)}</td>
            <td className="small">{r.linked_bet}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CampaignTable({ rows, signals, onOpen, preEvent = false }: { rows: any[]; signals: any[]; onOpen?: (id: string) => void; preEvent?: boolean }) {
  const sig = new Map(signals.map((s) => [s.campaign_id, s]));
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Campaign</th><th>Status</th><th className="r">Spend</th><th className="r">Registered</th><th className="r">Confirmed</th>
            <th className="r">Visitors</th><th className="r">Show rate</th><th className="r">Cost / reg.</th><th className="r">Cost / visitor</th>
            <th className="r">Opt-out</th><th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = sig.get(r.campaign_id);
            return (
              <tr key={r.campaign_id ?? "walkin"} className={r.campaign_id && onOpen ? "clickable" : ""} onClick={() => r.campaign_id && onOpen?.(r.campaign_id)}>
                <td><b>{r.campaign_name}</b><div className="small muted">{r.campaign_id ?? "no campaign"}{r.owner_name ? ` · ${r.owner_name}` : ""}</div></td>
                <td>{r.status ? <span className={`badge st-${r.status}`}>{r.status}</span> : ""}</td>
                <td className="r">{inr(r.spend_inr)}</td>
                <td className="r">{n0(r.registered_people)}</td>
                <td className="r">{n0(r.confirmed_people)}</td>
                <td className="r">{n0(r.visitors)}</td>
                <td className="r">{preEvent ? "—" : pct(r.registration_to_visit)}</td>
                <td className="r">{inr(r.cost_per_registration)}</td>
                <td className="r">{r.visitors && r.campaign_id ? inr(r.cost_per_visitor) : "—"}</td>
                <td className="r">{pct(r.opt_out_rate)}</td>
                <td title={s?.reason}><SignalBadge signal={s?.signal} />{s && <div className="small muted reason">{s.reason}</div>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
