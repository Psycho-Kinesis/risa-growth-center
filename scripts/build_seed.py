"""Convert the original xlsx into compact JSON seed files the app loads on setup.
    python scripts/build_seed.py "data/source/Attendee Dataset.xlsx" data/seed
Rows are kept exactly as supplied (duplicates included). Naive timestamps are IST."""
import json, os, sys
import pandas as pd

SHEETS = {
    "Event": ("src_event", ["event_starts_at", "event_ends_at"], ["history_start", "history_end"]),
    "Targets": ("src_targets", ["effective_at"], []),
    "Campaigns": ("src_campaigns", ["created_at", "planned_start_at", "planned_end_at"], []),
    "Daily Marketing": ("src_campaign_daily", [], ["activity_date"]),
    "People": ("src_people", ["first_seen_at"], []),
    "Interest and Engagement": ("src_lead_interactions", ["occurred_at"], []),
    "Registrations": ("src_registrations", ["registered_at"], []),
    "Registration History": ("src_registration_history", ["effective_at"], []),
    "Check-ins": ("src_checkins", ["occurred_at"], []),
}

def conv(v, kind):
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        return None
    if kind == "ts":
        t = pd.Timestamp(v)
        return None if pd.isna(t) else t.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
    if kind == "date":
        return pd.Timestamp(v).date().isoformat()
    if hasattr(v, "item"):
        v = v.item()
    return v

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
book = pd.read_excel(src, sheet_name=None)
manifest = []
for sheet, (table, ts, ds) in SHEETS.items():
    df = book[sheet]
    cols = list(df.columns)
    kinds = ["ts" if c in ts else "date" if c in ds else "raw" for c in cols]
    rows = [[conv(v, k) for v, k in zip(r, kinds)] for r in df.itertuples(index=False, name=None)]
    with open(os.path.join(out, f"{table}.json"), "w") as f:
        json.dump({"table": table, "columns": cols, "rows": rows}, f, separators=(",", ":"))
    manifest.append({"table": table, "sheet": sheet, "rows": len(rows)})
with open(os.path.join(out, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=1)
print(json.dumps(manifest, indent=1))
