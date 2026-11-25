"""Slide 1 model prototype — mirrors the spreadsheet formulas."""
import os, warnings, pandas as pd, psycopg
warnings.filterwarnings("ignore")
conn = psycopg.connect(os.environ["DATABASE_URL"])
cp = pd.read_sql("select * from f_campaign_perf('2025-04-20') where campaign_id is not null", conn).set_index("campaign_name")
ov = pd.read_sql("select * from f_overview('2025-04-20')", conn).iloc[0]

budget = {"Student Referrals":40000,"College Partnerships":60000,"Campus Ambassadors":60000,"Organic Search":20000,
          "Community Groups":25000,"Paid Social":55000,"Creator Partners":20000}
RESERVE = 300000 - sum(budget.values())
MULT = 1.5
def run(mult=MULT, show_adj=0.0):
    rows=[]
    for ch,b in budget.items():
        r=cp.loc[ch]; s=r.spend_inr; reg=r.registered_people; cpr=s/reg; sr=r.registration_to_visit
        lead_to_reg = reg / r.identified_people_first_touch; s2r = reg / r.sessions
        nreg = reg + (b-s)/(cpr*mult) if b>=s else reg - (s-b)/cpr
        rows.append(dict(channel=ch, spend25=s, reg25=reg, vis25=r.visitors, cpr=round(cpr,1), show=round(sr,4),
                         budget=b, reg=round(nreg,1), vis=round(nreg*(sr+show_adj),1),
                         leads=round(nreg/lead_to_reg,0), sessions=round(nreg/s2r,0)))
    return pd.DataFrame(rows)
df = run(); print(df.to_string()); 
reg_b = df.reg.sum(); vis_b = df.vis.sum() + 125
print(f"\nReserve {RESERVE}; BASE regs {reg_b:.0f} visitors {vis_b:.0f} (incl 125 walk-ins); weighted show {df.vis.sum()/reg_b:.4f}; CPV {300000/vis_b:.1f}")
print("base leads", df.leads.sum(), "sessions", df.sessions.sum(), "confirmed @89.3%", round(reg_b*2500/2800))
for m in [1.25,1.5,2.0]:
    d=run(m); print(f"sensitivity mult {m}: visitors {d.vis.sum()+125:.0f}")
# stretch levers
mix25 = {0:1142/2800,1:1408/2800,2:250/2800}
rate = {0:0.615,1:0.728,2:0.791}   # depth 2+ pooled (237 @.793 + 13 @.769)
target = {0:0.20,1:0.55,2:0.25}
sr25 = sum(mix25[k]*rate[k] for k in rate); srT = sum(target[k]*rate[k] for k in rate)
HAIRCUT = 0.5  # share of engagement uplift counted (overlap with channel mix; correlation != causation)
L1 = reg_b*(srT-sr25)*HAIRCUT
L2 = (88*0.77 + 29*0.5*0.77) * reg_b/2800
L3 = 250-125
L4 = 4*75*0.50
print(f"\nshow-rate mix 2025 {sr25:.4f} target {srT:.4f} uplift {srT-sr25:.4f}")
print(f"L1 {L1:.0f}  L2 {L2:.0f}  L3 {L3}  L4 {L4:.0f}  -> STRETCH {vis_b+L1+L2+L3+L4:.0f}")
st = vis_b+L1+L2+L3+L4
apv=3250/2050; d1=1905/3250; peak=400/1905
print(f"admissions/visitor {apv:.3f} day1 share {d1:.3f} peak-hour share {peak:.3f}")
print(f"stretch day1 admissions {st*apv*d1:.0f}; cap@3000/day -> max visitors {3000/(apv*d1):.0f}; balanced-days max {6000/apv:.0f}; peak/hr {st*apv*d1*peak:.0f}")
print(f"penetration base {vis_b/456778:.4%} stretch {st/456778:.4%}")
