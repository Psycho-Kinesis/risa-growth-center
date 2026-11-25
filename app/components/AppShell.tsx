"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Copilot from "./Copilot";
import { api } from "./api";
import { longDate } from "@/lib/format";

type Ctx = { asOf: string; setAsOf: (d: string) => void; version: number; bump: () => void; event: any };
const AppCtx = createContext<Ctx>({ asOf: "", setAsOf: () => {}, version: 0, bump: () => {}, event: null });
export const useApp = () => useContext(AppCtx);

const PRESETS = [
  { label: "Launch +3 wks", date: "2025-02-05" },
  { label: "Goal revised", date: "2025-03-15" },
  { label: "Mid-campaign", date: "2025-03-20" },
  { label: "Day before fest", date: "2025-04-11" },
  { label: "Final", date: "" },
];

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/tasks", label: "Tasks" },
  { href: "/settings", label: "Targets & data" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [latest, setLatest] = useState<string>("");
  const [event, setEvent] = useState<any>(null);
  const [version, setVersion] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const asOf = params.get("asOf") || latest;

  useEffect(() => {
    api("/api/dashboard").then((d) => { setLatest(d.asOf); setEvent(d.event); }).catch(() => setLatest("2025-04-20"));
  }, []);

  const setAsOf = useCallback((d: string) => {
    const sp = new URLSearchParams(params.toString());
    if (!d || d === latest) sp.delete("asOf"); else sp.set("asOf", d);
    router.replace(`${pathname}${sp.toString() ? "?" + sp : ""}`, { scroll: false });
  }, [params, router, pathname, latest]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ asOf, setAsOf, version, bump, event }), [asOf, setAsOf, version, bump, event]);
  const qs = params.get("asOf") ? `?asOf=${params.get("asOf")}` : "";

  return (
    <AppCtx.Provider value={value}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span>
          <div>
            <div className="brand-title">CampusFest Growth Center</div>
            <div className="brand-sub">Attendee growth · {event?.event_name ?? "…"} data · next edition: Bengaluru</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href + qs} className={pathname === n.href ? "active" : ""}>{n.label}</Link>
          ))}
        </nav>
        <div className="asof">
          <label htmlFor="asof">As of</label>
          <input id="asof" type="date" value={asOf} min={event?.history_start} max={latest || undefined}
                 onChange={(e) => setAsOf(e.target.value)} />
          <select aria-label="Jump to a date" value="" onChange={(e) => setAsOf(e.target.value)}>
            <option value="" disabled>Jump to…</option>
            {PRESETS.map((p) => <option key={p.label} value={p.date || latest}>{p.label}</option>)}
          </select>
        </div>
      </header>
      <div className="asof-note">
        Showing the state at the end of <b>{asOf ? longDate(asOf) : "…"}</b> (IST). Nothing dated later is counted.
      </div>
      <main className={chatOpen ? "main with-chat" : "main"}>{asOf ? children : <div className="loading">Loading…</div>}</main>
      <button className="chat-fab" onClick={() => setChatOpen((o) => !o)} aria-expanded={chatOpen}>
        {chatOpen ? "Close analyst" : "✦ Ask the AI analyst"}
      </button>
      <Copilot open={chatOpen} onClose={() => setChatOpen(false)} />
    </AppCtx.Provider>
  );
}
