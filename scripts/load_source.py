"""
Load the original RISA 'Attendee Dataset.xlsx' into Postgres (local or Supabase).

Usage:
    DATABASE_URL=postgresql://user:pass@host:5432/db \
        python scripts/load_source.py "data/source/Attendee Dataset.xlsx" [--reset]

* Rows are loaded exactly as supplied, including import-retry duplicates.
  Deduplication happens in the v_* views, so the raw evidence stays intact.
* Source timestamps are naive IST values; they are stored as timestamptz (+05:30).
* --reset truncates source tables first (app tables are left alone).
"""
import os
import sys
from datetime import datetime, date

import pandas as pd
import psycopg

IST = "+05:30"

# sheet name -> (table, {source column: db column}, timestamp columns, date columns)
SHEETS = {
    "Event": ("src_event", None,
              ["event_starts_at", "event_ends_at"], ["history_start", "history_end"]),
    "Targets": ("src_targets", None, ["effective_at"], []),
    "Campaigns": ("src_campaigns", None,
                  ["created_at", "planned_start_at", "planned_end_at"], []),
    "Daily Marketing": ("src_campaign_daily", None, [], ["activity_date"]),
    "People": ("src_people", None, ["first_seen_at"], []),
    "Interest and Engagement": ("src_lead_interactions", None, ["occurred_at"], []),
    "Registrations": ("src_registrations", None, ["registered_at"], []),
    "Registration History": ("src_registration_history", None, ["effective_at"], []),
    "Check-ins": ("src_checkins", None, ["occurred_at"], []),
}
LOAD_ORDER = ["Event", "Targets", "Campaigns", "Daily Marketing", "People",
              "Interest and Engagement", "Registrations", "Registration History", "Check-ins"]


def to_ts(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        return None
    if isinstance(v, str):
        v = pd.Timestamp(v)
    if pd.isna(v):
        return None
    if v.tzinfo is not None:
        return v.isoformat()
    return v.strftime("%Y-%m-%d %H:%M:%S") + IST


def to_date(v):
    if v is None or pd.isna(v):
        return None
    return pd.Timestamp(v).date().isoformat()


def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    if hasattr(v, "item"):  # numpy scalar -> python
        v = v.item()
    return v


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    reset = "--reset" in sys.argv
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Set DATABASE_URL")

    book = pd.read_excel(path, sheet_name=None)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        if reset:
            cur.execute("""truncate src_checkins, src_registration_history, src_registrations,
                           src_lead_interactions, src_people, src_campaign_daily,
                           src_targets restart identity""")
            cur.execute("delete from src_event")
            # campaigns are referenced by app_tasks; upsert instead of truncate
        for sheet in LOAD_ORDER:
            table, _, ts_cols, date_cols = SHEETS[sheet]
            df = book[sheet].copy()
            cols = list(df.columns)
            rows = []
            for rec in df.itertuples(index=False, name=None):
                out = []
                for c, v in zip(cols, rec):
                    if c in ts_cols:
                        out.append(to_ts(v))
                    elif c in date_cols:
                        out.append(to_date(v))
                    else:
                        out.append(clean(v))
                rows.append(out)
            collist = ", ".join(cols)
            if table == "src_campaigns":
                sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "campaign_id")
                sql = (f"insert into {table} ({collist}) values ({', '.join(['%s'] * len(cols))}) "
                       f"on conflict (campaign_id) do update set {sets}")
                cur.executemany(sql, rows)
            elif table == "src_event":
                sql = (f"insert into {table} ({collist}) values ({', '.join(['%s'] * len(cols))}) "
                       f"on conflict (event_name) do nothing")
                cur.executemany(sql, rows)
            else:
                with cur.copy(f"copy {table} ({collist}) from stdin") as cp:
                    for r in rows:
                        cp.write_row(r)
            print(f"{sheet:<26} -> {table:<26} {len(rows):>6} rows")
        conn.commit()
    print("done")


if __name__ == "__main__":
    main()
