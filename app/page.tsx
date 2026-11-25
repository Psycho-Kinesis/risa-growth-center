"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./components/AppShell";
import { api } from "./components/api";
import { Kpi, Funnel, Indicators, CampaignTable } from "./components/Widgets";
import { CumulativeChart, SpendChart } from "./components/Charts";
import { n0, pct, inr, longDate } from "@/lib/format";

export default function Overview() {
  const { asOf, version } = useApp();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    setErr("");
    api(`/api/dashboard?asOf=${asOf}`).then(setD).catch((e) => setErr(e.message));
  }, [asOf, version]);

  if (err) return <div className="card error-box">Could not load the dashboard: {err} {/set up|setup/i.test(err) ? "" : ""}<a href="/setup">Open setup</a></div>;
  if (!d) return <div className="loading">Loading dashboard…</div>;
  const o = d.overview, p = d.projection;
  const preEvent = o.event_phase === "pre-event";
  const alerts = d.leading.filter((x: any) => x.status === "alert").length;

  return (
    <div className="stack">
      <section className="headline">
        <div>
          <h1>{preEvent ? `${o.days_to_event} days to the fest` : o.event_phase === "event-days" ? "Fest in progress" : "Fest complete"}</h1>
          <p className="muted">Targets in force: <b>{o.target_version ?? "none yet"}</b> · {alerts ? <span className="alert-text">{alerts} leading indicator{alerts > 1 ? "s" : ""} on alert</span> : "no indicator on alert"}</p>
        </div>
        <div className={`projection ${Number(p.projected_gap_to_goal) >= 0 ? "good" : "alert"}`}>
          <div className="small">{preEvent ? "Projected unique visitors" : "Final unique visitors"}</div>
          <div className="proj-num">{n0(p.projected_visitors)} <span className="muted">/ {n0(p.visitors_goal)} goal</span></div>
          <div className="small">
            {Number(p.projected_gap_to_goal) >= 0 ? "Ahead by " : "Short by "}{n0(Math.abs(Number(p.projected_gap_to_goal)))}
            {preEvent && <> · run-rate {p.daily_registration_runrate}/day × {o.days_to_event} days, show rate {pct(p.show_rate_used)} <i>(assumption)</i> + {n0(p.walk_ins_used)} walk-ins <i>(assumption)</i></>}
          </div>
        </div>
      </section>

      <section className="grid kpis">
        <Kpi label="Unique verified visitors" value={o.unique_external_visitors} goal={o.visitors_goal} goalLabel="visitor goal" />
        <Kpi label="Registered people" value={o.registered_external_people} goal={o.registration_goal} goalLabel="registration goal" />
        <Kpi label="Identified people" value={o.identified_external_people} goal={o.identified_goal} goalLabel="goal" />
        <Kpi label="Marketing spend" value={o.spend_inr} fmt={inr} sub={`${pct(o.pct_budget_used / 100, 0)} of ${inr(o.budget_inr)} budget`} tone={o.pct_budget_used > 100 ? "alert" : undefined} />
        <Kpi label="Show rate (registered → attended)" value={o.show_rate} fmt={(v) => (preEvent ? "n/a yet" : pct(v))} sub={preEvent ? "Known after the fest" : `${n0(o.registered_visitors)} registered + ${n0(o.walk_in_visitors)} walk-ins`} />
        <Kpi label={preEvent ? "Cost per registration" : "Cost per visitor"} value={preEvent ? o.cost_per_registration : o.cost_per_visitor} fmt={inr}
             sub={`Confirmed ${n0(o.confirmed_external_people)} · cancelled ${n0(o.cancelled_external_people)} · waitlisted ${n0(o.waitlisted_external_people)}`} />
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Leading indicators</h2>
          <p className="muted small">Early signals from the Slide 3 plan. Thresholds are editable assumptions (Targets &amp; data).</p>
          <Indicators rows={d.leading} />
        </div>
        <div className="card">
          <h2>Funnel</h2>
          <p className="muted small">People are counted once; attendance = admitted and verified.</p>
          <Funnel rows={d.funnel} preEvent={preEvent} />
        </div>
      </section>

      <section className="grid two-wide">
        <div className="card">
          <h2>Cumulative progress vs goals</h2>
          <CumulativeChart daily={d.daily} goals={{ reg: o.registration_goal, vis: o.visitors_goal }} />
        </div>
        <div className="card">
          <h2>Spend vs budget</h2>
          <SpendChart daily={d.daily} budget={o.budget_inr} />
          <p className="small muted">Spend is the net ledger amount (vendor credits are negative).</p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Campaign performance & signals</h2>
          <span className="small muted">Click a campaign to manage it. Signals compare cost per {preEvent ? "registration" : "verified visitor"} with the blended value.</span>
        </div>
        <CampaignTable rows={d.campaigns} signals={d.signals} preEvent={preEvent} onOpen={(id) => router.push(`/campaigns?id=${id}${asOf ? `&asOf=${asOf}` : ""}`)} />
      </section>

      <section className="small muted footnote">
        Data quality: {d.dataQuality.map((x: any) => `${x.source_table} ${n0(x.raw_rows - x.unique_ids)} duplicate rows removed`).filter((s: string) => !s.endsWith(" 0 duplicate rows removed")).join(" · ") || "no duplicates"}.
        Data runs {longDate(d.event?.history_start)} to {longDate(d.event?.history_end)}.
      </section>
    </div>
  );
}
