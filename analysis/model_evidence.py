"""Evidence for the Slide 1 model, from the supplied dataset (final snapshot)."""
import os, sys, warnings
import pandas as pd, psycopg
warnings.filterwarnings("ignore")
pd.set_option("display.width", 200)
conn = psycopg.connect(os.environ["DATABASE_URL"])
q = lambda s: pd.read_sql(s, conn)

reg = q("select * from f_registrations_asof('2025-04-20') where person_type='external'")
vis = q("select * from f_visitors_asof('2025-04-20') where person_type='external'")
reg["attended"] = reg.person_id.isin(vis.person_id)
print("Show rate by latest status:\n", reg.groupby("status").attended.agg(["count","mean"]).round(3))

li = q("""select i.person_id, i.event_type from v_lead_interactions i join v_people p using(person_id)
          where p.person_type='external'""")
flags = li.assign(v=1).pivot_table(index="person_id", columns="event_type", values="v", aggfunc="max").fillna(0)
r = reg.merge(flags, left_on="person_id", right_index=True, how="left").fillna(0)
for col in ["brochure_download","event_question_submitted","nurture_email_opened","nurture_email_clicked","opted_out","page_visit"]:
    if col in r:
        g = r.groupby(r[col] > 0).attended.agg(["count","mean"]).round(3)
        print(f"\nShow rate by {col}:\n{g}")
# engagement depth
r["depth"] = (r.get("brochure_download",0)>0).astype(int) + (r.get("event_question_submitted",0)>0).astype(int) + (r.get("nurture_email_clicked",0)>0).astype(int)
print("\nShow rate by engagement depth (brochure+question+email click):\n", r.groupby("depth").attended.agg(["count","mean"]).round(3))

# timing
reg["weeks_before"] = ((pd.Timestamp("2025-04-12", tz="Asia/Kolkata") - pd.to_datetime(reg.registered_at).dt.tz_convert("Asia/Kolkata")).dt.days // 7)
print("\nShow rate by weeks before event registered:\n", reg.groupby(pd.cut(reg.weeks_before,[-1,1,3,5,8,20])).attended.agg(["count","mean"]).round(3))
reg["month"] = pd.to_datetime(reg.registered_at).dt.tz_convert("Asia/Kolkata").dt.to_period("M")
print("\nRegistrations by month:\n", reg.groupby("month").size())

# admissions per visitor and day split
ci = q("""select f_ist_date(occurred_at) d, count(*) n, count(distinct person_id) u from v_checkins c join v_people p using(person_id)
          where result='admitted' and verification='verified' and p.person_type='external' group by 1 order by 1""")
print("\nVerified external admissions by day:\n", ci)
print("admissions per visitor:", round(vis.admission_events.sum()/len(vis),3))
both = q("""select count(*) from (select person_id from v_checkins c join v_people p using(person_id)
            where result='admitted' and verification='verified' and p.person_type='external'
            group by person_id having count(distinct f_ist_date(occurred_at))=2) x""")
print("visitors on both days:", int(both.iloc[0,0]))
hr = q("""select extract(hour from occurred_at at time zone 'Asia/Kolkata') h, f_ist_date(occurred_at) d, count(*) n
          from v_checkins where result='admitted' and verification='verified' group by 1,2 order by 2,1""")
print("\nPeak admissions in an hour:", hr.n.max())
den = q("select result, verification, source, count(*) from v_checkins group by 1,2,3 order by 1")
print(den)

# lead -> registration by channel (first touch identified vs registered by registration source)
cp = q("select campaign_name, identified_people_first_touch id, registered_people reg, visitors vis, spend_inr sp from f_campaign_perf('2025-04-20')")
cp["id_to_reg"] = (cp.reg/cp.id).round(3)
print(cp)
