"""
Independent pandas implementation of the metric rules, used to cross-check
the SQL layer. Reads the ORIGINAL xlsx (not the database).

    python analysis/reference_metrics.py "data/source/Attendee Dataset.xlsx"
"""
import sys
import pandas as pd


def load(path):
    A = pd.read_excel(path, sheet_name=None)
    key = {"Daily Marketing": "activity_id", "People": "person_id",
           "Interest and Engagement": "interaction_id", "Registrations": "registration_id",
           "Registration History": "history_id", "Check-ins": "event_id"}
    for s, k in key.items():
        A[s] = A[s].drop_duplicates(k, keep="last")          # R3
    return A


def cutoff(as_of):                                            # R1: end of IST day
    return pd.Timestamp(as_of) + pd.Timedelta(days=1)


def overview(A, as_of):
    co = cutoff(as_of)
    t = A["Targets"][A["Targets"].effective_at < co].sort_values("effective_at").iloc[-1]
    ppl = A["People"]
    ext = set(ppl.loc[ppl.person_type == "external", "person_id"])     # R4
    identified = ppl[(ppl.person_type == "external") & (ppl.first_seen_at < co)].person_id.nunique()

    reg = A["Registrations"][A["Registrations"].registered_at < co]
    reg = reg[reg.person_id.isin(ext)]
    rh = A["Registration History"]
    rh = rh[rh.effective_at < co].sort_values(["registration_id", "effective_at", "history_id"])
    latest = rh.groupby("registration_id").tail(1)[["registration_id", "status"]]   # R2
    reg = reg.merge(latest, on="registration_id", how="left")
    st = reg.groupby("status").person_id.nunique()

    ci = A["Check-ins"]
    ok = ci[(ci.result == "admitted") & (ci.verification == "verified") & (ci.occurred_at < co)]  # R5
    ok = ok[ok.person_id.isin(ext)]
    visitors = ok.person_id.nunique()
    walk = ok[~ok.person_id.isin(reg.person_id)].person_id.nunique()

    dm = A["Daily Marketing"]
    spend = int(dm[dm.activity_date <= pd.Timestamp(as_of)].marketing_spend_inr.sum())   # R7
    return {
        "target_version": t.target_version,
        "identified_external_people": identified,
        "registered_external_people": reg.person_id.nunique(),
        "confirmed_external_people": int(st.get("confirmed", 0)),
        "cancelled_external_people": int(st.get("cancelled", 0)),
        "waitlisted_external_people": int(st.get("waitlisted", 0)),
        "unique_external_visitors": visitors,
        "walk_in_visitors": walk,
        "verified_admission_events": len(ok),
        "spend_inr": spend,
        "budget_inr": int(t.marketing_budget_inr),
    }


def campaign_perf(A, as_of):
    co = cutoff(as_of)
    ppl = A["People"]
    ext = set(ppl.loc[ppl.person_type == "external", "person_id"])
    dm = A["Daily Marketing"]
    dm = dm[dm.activity_date <= pd.Timestamp(as_of)]
    out = dm.groupby("campaign_id").agg(spend_inr=("marketing_spend_inr", "sum"),
                                        sessions=("landing_page_sessions", "sum"))
    reg = A["Registrations"]
    reg = reg[(reg.registered_at < co) & reg.person_id.isin(ext)]
    rh = A["Registration History"]
    rh = rh[rh.effective_at < co].sort_values(["registration_id", "effective_at", "history_id"])
    latest = rh.groupby("registration_id").tail(1)[["registration_id", "status"]]
    reg = reg.merge(latest, on="registration_id", how="left")
    out["registered_people"] = reg.groupby("campaign_id").person_id.nunique()
    out["confirmed_people"] = reg[reg.status == "confirmed"].groupby("campaign_id").person_id.nunique()
    ci = A["Check-ins"]
    ok = ci[(ci.result == "admitted") & (ci.verification == "verified") & (ci.occurred_at < co)
            & ci.person_id.isin(ext)]
    first_reg = (A["Registrations"][A["Registrations"].registered_at < co]
                 .sort_values(["registered_at", "registration_id"]).groupby("person_id").head(1))
    vis = pd.DataFrame({"person_id": ok.person_id.unique()}).merge(
        first_reg[["person_id", "campaign_id"]], on="person_id", how="left")
    out["visitors"] = vis.groupby("campaign_id").person_id.nunique()
    return out.fillna(0).astype(int).sort_index()


if __name__ == "__main__":
    A = load(sys.argv[1])
    for d in sys.argv[2:] or ["2025-04-20"]:
        print(d, overview(A, d))
        print(campaign_perf(A, d))
