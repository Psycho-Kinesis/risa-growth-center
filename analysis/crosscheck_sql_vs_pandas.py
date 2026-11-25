"""
Cross-check: SQL metric functions vs the independent pandas reference.

    DATABASE_URL=... python analysis/crosscheck_sql_vs_pandas.py "data/source/Attendee Dataset.xlsx"
Exits non-zero on any mismatch.
"""
import os
import sys

import pandas as pd
import psycopg

sys.path.insert(0, os.path.dirname(__file__))
from reference_metrics import load, overview, campaign_perf  # noqa: E402

DATES = ["2025-01-31", "2025-02-28", "2025-03-14", "2025-03-15",
         "2025-04-11", "2025-04-12", "2025-04-13", "2025-04-20"]
OV_KEYS = ["target_version", "identified_external_people", "registered_external_people",
           "confirmed_external_people", "cancelled_external_people", "waitlisted_external_people",
           "unique_external_visitors", "walk_in_visitors", "verified_admission_events",
           "spend_inr", "budget_inr"]
CP_KEYS = ["spend_inr", "sessions", "registered_people", "confirmed_people", "visitors"]

A = load(sys.argv[1])
fails = 0
with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
    for d in DATES:
        sql = pd.read_sql(f"select * from f_overview('{d}')", conn).iloc[0].to_dict()
        ref = overview(A, d)
        for k in OV_KEYS:
            if str(sql[k]) != str(ref[k]):
                fails += 1
                print(f"MISMATCH overview {d} {k}: sql={sql[k]} ref={ref[k]}")
        cps = (pd.read_sql(f"select * from f_campaign_perf('{d}') where campaign_id is not null", conn)
               .set_index("campaign_id")[CP_KEYS].astype(int).sort_index())
        cpr = campaign_perf(A, d).reindex(cps.index).fillna(0).astype(int)[CP_KEYS]
        diff = (cps != cpr)
        if diff.values.any():
            fails += int(diff.values.sum())
            print(f"MISMATCH campaign_perf {d}:\nSQL\n{cps}\nREF\n{cpr}")
        print(f"{d}: overview {len(OV_KEYS)} fields + campaign_perf {cps.size} cells checked "
              f"| visitors={sql['unique_external_visitors']} reg={sql['registered_external_people']} "
              f"spend={sql['spend_inr']} target={sql['target_version']}")
print("ALL MATCH" if fails == 0 else f"{fails} MISMATCHES")
sys.exit(1 if fails else 0)
