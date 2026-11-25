"use client";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart,
} from "recharts";
import { n0, inr, shortDate } from "@/lib/format";

const C = { reg: "#4f46e5", vis: "#0d9488", ident: "#a3a3a3", spend: "#d97706", budget: "#dc2626" };

export function CumulativeChart({ daily, goals }: { daily: any[]; goals: { reg?: number; vis?: number; ident?: number } }) {
  const data = daily.map((d) => ({ day: d.day, Registered: d.cum_registrations, Visitors: d.cum_visitors, Identified: d.cum_identified }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
        <XAxis dataKey="day" tickFormatter={shortDate} minTickGap={28} fontSize={11} />
        <YAxis fontSize={11} tickFormatter={(v) => n0(v)} width={48}
               domain={[0, (max: number) => Math.ceil(Math.max(max, goals.reg || 0, goals.vis || 0) * 1.08 / 100) * 100]} />
        <Tooltip formatter={(v) => n0(v)} labelFormatter={(l) => shortDate(String(l))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="Identified" stroke={C.ident} dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="Registered" stroke={C.reg} dot={false} strokeWidth={2.2} />
        <Line type="stepAfter" dataKey="Visitors" stroke={C.vis} dot={false} strokeWidth={2.2} />
        {goals.reg ? <ReferenceLine y={goals.reg} stroke={C.reg} strokeDasharray="5 4" label={{ value: `Reg. goal ${n0(goals.reg)}`, fontSize: 10, fill: C.reg, position: "insideTopLeft" }} /> : null}
        {goals.vis ? <ReferenceLine y={goals.vis} stroke={C.vis} strokeDasharray="5 4" label={{ value: `Visitor goal ${n0(goals.vis)}`, fontSize: 10, fill: C.vis, position: "insideBottomLeft" }} /> : null}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SpendChart({ daily, budget }: { daily: any[]; budget?: number }) {
  const data = daily.map((d) => ({ day: d.day, Spend: d.cum_spend_inr }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
        <XAxis dataKey="day" tickFormatter={shortDate} minTickGap={28} fontSize={11} />
        <YAxis fontSize={11} tickFormatter={(v) => "₹" + Math.round(Number(v) / 1000) + "k"} width={48}
               domain={[0, (max: number) => Math.ceil(Math.max(max, budget || 0) * 1.08 / 10000) * 10000]} />
        <Tooltip formatter={(v) => inr(v)} labelFormatter={(l) => shortDate(String(l))} />
        <Area type="monotone" dataKey="Spend" stroke={C.spend} fill={C.spend} fillOpacity={0.15} strokeWidth={2} />
        {budget ? <ReferenceLine y={budget} stroke={C.budget} strokeDasharray="5 4" label={{ value: `Budget ${inr(budget)}`, fontSize: 10, fill: C.budget, position: "insideTopLeft" }} /> : null}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DailyBars({ daily }: { daily: any[] }) {
  const data = daily.map((d) => ({ day: d.day, Spend: d.spend_inr, Registrations: d.new_registrations }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
        <XAxis dataKey="day" tickFormatter={shortDate} minTickGap={28} fontSize={11} />
        <YAxis yAxisId="l" fontSize={11} width={40} />
        <YAxis yAxisId="r" orientation="right" fontSize={11} width={48} tickFormatter={(v) => "₹" + Math.round(Number(v) / 1000) + "k"} />
        <Tooltip formatter={(v, n) => (n === "Spend" ? inr(v) : n0(v))} labelFormatter={(l) => shortDate(String(l))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="l" dataKey="Registrations" fill={C.reg} />
        <Bar yAxisId="r" dataKey="Spend" fill={C.spend} fillOpacity={0.6} />
      </BarChart>
    </ResponsiveContainer>
  );
}
