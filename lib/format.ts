export const n0 = (v: unknown) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString("en-IN");
export const inr = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : "₹" + n0(v));
export const pct = (v: unknown, digits = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : (Number(v) * 100).toFixed(digits) + "%";
export const signed = (v: number, digits = 0) => (v > 0 ? "+" : "") + v.toFixed(digits);
export const shortDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? d + "T00:00:00+05:30" : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "—";
export const longDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? d + "T00:00:00+05:30" : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
export const dateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
