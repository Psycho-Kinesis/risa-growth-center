# CampusFest Growth Center

**RISA Labs · Growth APM assignment · Challenge A: Attendee Growth · Festival city: Bengaluru**
Author: Aditya Kumar Singh (IIT Kharagpur)

A working command center for growing **attendance** at a two-day college festival. It has three parts:

1. **Analytics dashboard.** The full funnel, targets vs actuals, campaign KPIs, budget, projections and leading indicators, correct for any "as of" date.
2. **Campaign and task management.** Edit campaigns, budgets, owners, targets and daily marketing data, and run a task board. Every change saves and immediately flows into the analytics.
3. **Embedded AI growth analyst.** A Gemini model with function calling that answers from the live database. It does exact maths, diagnoses problems, recommends actions and drafts tasks or campaign changes that only apply after the user presses **Confirm**. It says plainly when the data cannot answer.

| Deliverable | Where |
|---|---|
| Three-slide strategy (PDF) | submitted separately (exported from the deck) |
| Working product | **https://risa-growth-center-virid.vercel.app** (to run your own copy, see [Deploy](#deploy-in-about-15-minutes)) |
| Slide 1 model with live formulas | spreadsheet export, mirrored by `analysis/slide1_model.py` |
| This README | research, assumptions, calculations, framework, setup, tools, limitations |

---

## 1. Headline

| | 2025 actual (dataset) | Base 2026 | Stretch 2026 | Venue ceiling |
|---|---|---|---|---|
| Unique verified external visitors | **2,050** (goal 2,200) | **2,467** (+20%) | **2,883** (+41%) | 3,228 |
| Registered external people | 2,800 | 3,124 | 3,424 | — |
| Marketing spend | ₹2,74,000 | ₹3,00,000 | ₹3,00,000 | — |
| Cost per verified visitor | ₹134 | ₹122 | ₹104 | — |

The market is not the constraint. Even the stretch case reaches about 0.6% of Bengaluru's estimated college students. The binding constraints are **channel efficiency** and **Day-1 venue capacity**.

---

## 2. Research and data sources

Every input is labelled as one of three kinds. The app's `app_assumptions` table and the spreadsheet use the same labels.

| Kind | Item | Value | Source |
|---|---|---|---|
| **Sourced** | Colleges in Bengaluru Urban district | 1,106, the most of any district in India | AISHE 2021-22, Ministry of Education (reported by Siasat and Deccan Herald) |
| **Sourced** | Average enrolment per college, Karnataka | 413 | AISHE 2021-22 (reported by Deccan Herald) |
| **Derived** | Bengaluru college students | 1,106 × 413 ≈ 4.57 lakh (leaves out universities, so conservative) | calculation |
| **Sourced** | Namma Metro ridership | 8–9 lakh a day; network about 96 km after the Yellow Line (Aug 2025) | Deccan Herald, 11 Aug 2025 |
| **Dataset** | Everything about CampusFest 2025 | channels, funnel, show rates, costs | RISA "Attendee Dataset.xlsx" (fictional), kept unchanged in `data/source/` |
| **Assumption** | Marginal cost of extra spend, show-rate uplift, sponsor reach, walk-ins, venue capacity, thresholds | see §4–§6 | judgement, each stated and editable |

**Why Bengaluru.** It has the largest pool of college students reachable in one city, the densest club and fest culture to partner with, and a metro network that turns "interested" into "showed up". The startup and brand ecosystem also helps sponsor co-distribution (bet 4).

**Framing.** The dataset is treated as last year's edition of our festival. Its unit economics (cost per registration, show rate by channel, engagement, capacity profile) are the evidence base for the 2026 Bengaluru plan.

---

## 3. How the data is handled (and verified)

Rules taken from the dataset's own *Read me* and *Field guide*, implemented in SQL (`db/03_metrics.sql`):

- **As-of date** = end of that day in IST. Every metric is a function of the date, so nothing dated later can leak into an earlier snapshot.
- **History tables** (registration status, targets) use the latest version in force at the date; states are never summed.
- **Duplicates.** The raw rows are kept (`src_*` tables). Clean views (`v_*`) keep one row per stable ID: 2 marketing, 4 status-history and 20 check-in rows were import copies.
- **Targets count external people only** (internal, staff and test people are excluded).
- **Attendance** = a distinct person with a check-in that is **admitted and verified**. Pending, unverified and denied entries don't count, and a repeat admission is still one person (3,250 verified admissions = 2,050 people).
- **Anonymous counts** (impressions, clicks, reach, sessions, form starts) are never added into people.
- **Spend** = net ledger amount, so vendor credits are negative.
- **Attribution** = the registration's recorded source campaign. Walk-ins are unattributed. Attribution is observational, not causal.

Full definitions: [`docs/METRICS.md`](docs/METRICS.md).

**Verification**
- `analysis/crosscheck_sql_vs_pandas.py` compares the SQL with an independent pandas implementation at 8 dates (including the 15 Mar target change and both fest days). **All match.**
- `analysis/test_changed_data.sql` runs 9 "reviewer edits the data" tests: duplicates, repeat admissions, pending check-ins, staff, future-dated cancellations, credits and new target versions. **All pass.**

---

## 4. Slide 1: the model and its calculations

### 4.1 Channel economics (2025, final snapshot)
| Channel | Spend | Registered | Verified visitors | Cost / registration | Show rate | Cost / visitor |
|---|---:|---:|---:|---:|---:|---:|
| Student Referrals | ₹19,000 | 350 | 275 | ₹54 | 78.6% | ₹69 |
| Organic Search | ₹14,000 | 250 | 195 | ₹56 | 78.0% | ₹72 |
| College Partnerships | ₹31,000 | 450 | 385 | ₹69 | 85.6% | ₹81 |
| Community Groups | ₹16,000 | 200 | 165 | ₹80 | 82.5% | ₹97 |
| Campus Ambassadors | ₹42,000 | 520 | 390 | ₹81 | 75.0% | ₹108 |
| Paid Social | ₹93,000 | 680 | 340 | ₹137 | 50.0% | ₹274 |
| Creator Partners | ₹59,000 | 350 | 175 | ₹169 | 50.0% | ₹337 |
| **Total** (+125 walk-ins) | **₹2,74,000** | **2,800** | **1,925 + 125** | ₹98 | 68.75% | ₹134 |

### 4.2 Base case: reallocate the same ₹3,00,000
For each channel *c*, with 2025 spend *S*, registrations *R*, cost per registration *CPR = S/R*, show rate *SR*, and 2026 budget *B*:

```
if B ≥ S:  registrations = R + (B − S) / (CPR × 1.5)     # every extra rupee costs 1.5× the 2025 average (diminishing returns)
else:      registrations = R − (S − B) / CPR              # cuts lose registrations at the 2025 average (conservative)
visitors = registrations × SR
```

| Channel | 2026 budget | Registrations | Visitors | Worked example |
|---|---:|---:|---:|---|
| Student Referrals | ₹40,000 | 608 | 478 | 350 + 21,000 / (54.29 × 1.5) = 607.9; × 0.7857 |
| College Partnerships | ₹60,000 | 731 | 625 | |
| Campus Ambassadors | ₹60,000 | 669 | 501 | |
| Organic Search | ₹20,000 | 321 | 251 | |
| Community Groups | ₹25,000 | 275 | 227 | |
| Paid Social (retarget only) | ₹55,000 | 402 | 201 | 680 − 38,000 / 136.76 = 402.2; × 0.50 |
| Creator Partners (pay per result) | ₹20,000 | 119 | 59 | |
| Reserve (funds bets 3 and 5) | ₹20,000 | — | — | |
| **Total** | **₹3,00,000** | **3,124** | **2,342 + 125 walk-ins = 2,467** | |

Upstream funnel (back-solved from 2025 conversion): 27,274 landing sessions → 3,746 leads → 3,124 registered → 2,790 confirmed → 2,467 visitors.
**Sensitivity:** if extra spend costs 1.25× instead of 1.5×, the base is 2,602; at 2.0× it is 2,299.

### 4.3 Stretch levers (on top of the base)
| Lever | Calculation | Extra visitors |
|---|---|---:|
| L1 Show-up engine | 2025 show rate by engagement depth: 61.5% (none), 72.8% (one action), 79.1% (two or more). Moving the registrant mix from 41/50/9% to 20/55/25% raises the show rate 68.75% → 72.12% (+3.36 pts). **Half is counted** (overlap with the better channel mix; correlation isn't causation): 3,124 × 0.0336 × 0.5 | **53** |
| L2 Waitlist & "interested" recovery | 88 waitlisted + 29 "interested" registrants never attended, while 183 cancellations freed seats. (88 + 29 × 0.5) × 77% (confirmed show rate) × 3,124 / 2,800 | **88** |
| L3 Day-of walk-in drive | 2025 walk-ins 125 (no targeted marketing) → 250 | **125** |
| L4 Sponsor co-distribution | 4 sponsors × 75 registrations × 50% show (cold-audience rate) | **150** |
| **Stretch** | 2,467 + 53 + 88 + 125 + 150 | **2,883** |

### 4.4 Capacity
Each visitor made 1.585 verified admissions (3,250 / 2,050) and 58.6% of admissions were on Day 1. The busiest hour took 21% of the day.
- Stretch: 2,883 × 1.585 = 4,570 admissions; Day 1 = 2,679, so **89% of a 3,000-a-day venue** (assumption: confirm with the venue).
- Ceiling: 3,000 / (1.585 × 0.586) = **3,228 visitors** before Day 1 is full; 3,785 if a Day-2 headliner balances the days.
- Gates: Day-1 peak hour ≈ 563 admissions, so **4 lanes** at 150 scans per lane per hour.

### 4.5 Target audiences
| Priority | Segment | Size (basis) | 2025 cost / visitor | Show rate |
|---|---|---|---:|---:|
| 1 | Students at partner colleges (clubs, fest committees) | 24,780 (60 colleges × 413) | ₹81 | 85.6% |
| 1 | Friends of registrants | 15,622 (3,124 registrants × 5) | ₹69 | 78.6% |
| 2 | Students on ambassador campuses | 12,390 (30 × 413) | ₹108 | 75.0% |
| 2 | Students already searching | 1,893 sessions in 2025 | ₹72 | 78.0% |
| 3 | Interest communities | 10,000 (assumption) | ₹97 | 82.5% |
| 3 | People near the venue on fest days | 8–9 lakh metro riders a day, city-wide | — | — |
| 4 | Broad Bengaluru student audience on social | 4.57 lakh | ₹274 | 50.0% |
| 5 | Creator followers | platform-reported only | ₹337 | 50.0% |

---

## 5. Slide 2: prioritisation framework

**Score = extra verified visitors × confidence** (ICE-style expected value). Ties go to the bet that is cheaper and gives a readable signal sooner.

Confidence reflects how much 2025 evidence backs the mechanism: proven channel 80%, process change 70%, on-ground and untested 50%, depends on another team 40%.

| Rank | Bet | Extra visitors | Confidence | Risk-adjusted | Extra cash | Cash per extra visitor | First signal | Call |
|---|---|---:|---:|---:|---:|---:|---|---|
| 1 | Campus network (60 partner colleges + ambassadors) | 351 | 80% | 281 | ₹47,000 | ₹134 | 2 weeks | Double down |
| 2 | Squad referrals (share link, group priority entry) | 203 | 80% | 162 | ₹21,000 | ₹103 | 1–2 weeks | Double down |
| 3 | Show-up engine (L1 + L2) | 141 | 70% | 99 | ₹12,000 | ₹85 | 1 week | Double down (raises the yield of 1 and 2) |
| 4 | Sponsor co-distribution (L4) | 150 | 40% | 60 | ₹0 | — | 7 days | Test with 2 sponsors |
| 5 | Day-of walk-in drive (L3) | 125 | 50% | 63 | ₹8,000 | ₹64 | Day 1, 2 pm | Test, only if Day 1 < 85% full |

Bets 4 and 5 are a near tie. Bet 4 ranks higher because it costs no cash and can be read within 7 days, while walk-ins can only be read during the fest.

**Funding and rejections**
- **Paid Social ₹93k → ₹55k, retarget only:** ₹274 per visitor, 50% show rate, 12.2% opt-outs.
- **Creators ₹59k → ₹20k, pay per verified registration:** ₹337 per visitor.
- **More nurture email: rejected.** Openers showed up 68.9% of the time vs 68.7% for non-openers.
- **Celebrity headliner to drive sign-ups: rejected.** Expensive, and Day 1 is already the bottleneck. A Day-2 act is useful only to spread the load.

**Reconciliation:** 2,050 + bets 970 + organic/community growth 118 − 255 lost to the cuts = **2,883**, within ₹3,00,000.

---

## 6. Slide 3: signals, thresholds and actions (built into the app)

| Bet | Early signal | Scale if | Change if | Stop if |
|---|---|---|---|---|
| 1 Campus network | MoUs by T−8; sign-ups per college in 14 days | ≥ 12 and ≤ ₹100 each → add 10 colleges | 6–11 → on-campus qualifier | < 3 in 14 days → drop the college |
| 2 Squad referrals | Referral share of new sign-ups (14 days) | ≥ 20% and cancels ≤ 6.5% → bigger reward | 12–20% → priority entry, one-tap share | < 12% after 3 weeks → money to bet 1 |
| 3 Show-up engine | Engaged share; people stuck on the waitlist; holdout gap | ≥ 75% and ≥ 3 pts over holdout → add a T−2 reminder | 60–75% → redesign the picker | opt-outs > 10% or < 1 pt lift → stop WhatsApp |
| 4 Sponsor links | Sign-ups per sponsor link in 7 days | ≥ 25 → add 2 sponsors | 10–24 → change the perk | < 10 → stop |
| 5 Walk-in drive | Walk-ins by 2 pm Day 1; venue use | ≥ 60 and < 85% full → push Day-2 content | 85–90% → stagger entry | > 90% → stop street teams |

**Guardrails:**
- projected visitors < 95% of goal → move the reserve to the best-signal bet
- any campaign ≥ 1.75× the blended cost per visitor → stop
- opt-outs > 10% or cancellations > 8% → fix
- spend > 15 points ahead of the calendar → freeze

**In the product:**
- `f_leading_indicators(date)` computes the indicators with a good / watch / alert status.
- `f_campaign_signals(date)` gives every campaign a scale / fix / stop / hold badge with its reason. It uses cost per registration before the fest and cost per verified visitor after.
- All thresholds are rows in `app_assumptions`, editable on *Targets & data*.

**Back-test on 2025, as of 20 Mar (23 days out):**
- projected 1,793 visitors vs the 2,200 goal
- 54 people stuck on the waitlist
- only 55.5% of registrants engaged
- Paid Social flagged *fix* for 10.4% opt-outs

The fest finished 150 short of goal, so the signals were visible three weeks early.

---

## 7. The product

### Pages
| Page | What it does | Requirement |
|---|---|---|
| **Overview** | KPI cards vs targets, projection (assumptions labelled), leading indicators, funnel with biggest drop-off, cumulative progress vs goals, spend vs budget, campaign table with signals and reasons, data-quality note | Measure · Diagnose · Support decisions |
| **Campaigns** | Per-campaign KPIs, funnel and daily chart. Edit status, planned budget, owner and notes. Add daily marketing data, or correct a day (a new version; the original stays in the audit trail). Create campaigns. Per-campaign tasks | Manage execution |
| **Tasks** | Board (to do / in progress / blocked / done), owners, due dates (overdue judged at the as-of date), priority, evidence, tasks from the AI marked | Manage execution |
| **Targets & data** | Target versions (a new version applies only from its date), editable assumptions, activity log of every change (user or confirmed AI) | Support decisions · auditability |
| **Setup** | One-click database initialisation, **reset to the original dataset** (for testing), AI connection test | Ops |
| **AI analyst** (panel on every page) | Grounded Q&A, diagnosis, recommendations, confirm-to-execute proposals, a "Data used" trace under every answer | AI copilot |

Screenshots: [`docs/screenshots/`](docs/screenshots/) (Overview as of 20 Mar and final, Campaigns, AI analyst).

The **As of** picker in the header (with presets: launch +3 weeks, goal revised, mid-campaign, day before the fest, final) re-computes everything for that date.

### AI analyst: design
- **Model:** Gemini via the REST `generateContent` API with function calling. The default model is `gemini-flash-latest`, Google's auto-updating alias; override it with `GEMINI_MODEL`. No deprecated sampling parameters are sent. Each model turn is sent back unchanged, so **thought signatures** are preserved and function responses carry the call `id`, as the API requires.
- **15 tools** (`lib/copilot/tools.ts`):
  - **Read:** `get_overview`, `get_campaign_performance`, `get_campaign_signals`, `get_leading_indicators`, `get_funnel`, `get_daily_trend`, `get_projection`, `compare_dates`, `get_targets_and_assumptions`, `list_campaigns`, `list_tasks`.
  - **Ad-hoc:** `query_data` (one read-only SQL query over documented views).
  - **Maths:** `calculate` (exact arithmetic).
  - **Execution:** `propose_task`, `propose_campaign_update`.
- **Grounding:** the system prompt requires every number to come from a tool result in the conversation, and uses the dataset's own definitions. It separates evidence from assumptions and labels assumptions as such.
- **Honesty:** the model is told what the data does *not* contain: demographics, ticket revenue, surveys, non-marketing costs, anything after 20 Apr 2025, and controlled experiments. It must say so and offer the closest supported answer, flag thin evidence (under 30 registrations), and report tool errors instead of inventing results.
- **Execution with confirmation:** proposals are stored in `app_pending_actions` and shown as cards. Only `POST /api/actions/:id {decision: "confirm"}` changes data. Each proposal can be confirmed once, and the change is logged with actor `ai_copilot`.
- **Safety of ad-hoc SQL:** a single SELECT/WITH statement only, with a keyword blocklist (string literals stripped first). It runs inside a `READ ONLY` transaction with a 5-second timeout and a 200-row cap, and is always rolled back.
- **Follow-ups:** the conversation history is sent with each turn. The selected as-of date is in the system prompt, and any tool can be asked about another date.

### Demo workflow (one complete loop)
1. Set **As of → Mid-campaign (20 Mar 2025)**. The Overview shows the projection 407 short, 3 indicators on alert, and Paid Social and Creators flagged *fix*.
2. Open **Ask the AI analyst** and ask: *"How are we tracking against the visitor goal, and what's the projected gap?"* It answers from `get_overview` and `get_projection`, with the assumptions labelled.
3. Follow-up: *"What's driving it?"* It uses `get_leading_indicators` and `get_campaign_signals`, pointing to 54 people stuck on the waitlist, 55.5% engaged share, and Paid Social at 10.4% opt-outs.
4. *"What would moving ₹15,000 from Paid Social to Student Referrals add?"* It uses `calculate` with the 2025 cost per registration and show rates, and labels the 1.5× marginal-cost assumption.
5. *"Create a task for Dev to do that by 25 March."* A **Proposed task** card appears. Press **Confirm**, and the task shows on the **Tasks** board with its evidence, marked *from AI analyst*. The activity log records it.
6. *"What's the gender split of our attendees?"* It says the data has no demographics, what data would answer it, and what it can say instead.
7. Change data, for example add a daily entry or a new target version, and ask again. Answers reflect the change immediately. Use **Setup → Reset to original data** to start over.

---

## 8. Architecture

```
Browser (Next.js App Router, React 19, Recharts)
   │  fetch /api/*
   ▼
Next.js route handlers (Vercel serverless, region bom1)
   ├─ lib/queries.ts        validation + writes (transactions, activity log)
   ├─ lib/copilot/*         Gemini tool-calling loop, tools, SQL guard, calculator
   └─ lib/setup.ts          schema + seed loader (used by /setup and `npm run db:setup`)
   │  node-postgres
   ▼
PostgreSQL (Supabase)
   ├─ src_*  raw source rows (duplicates kept; app-entered rows tagged origin='app')
   ├─ v_*    de-duplicated views
   ├─ f_*    as-of-date metric functions (overview, campaign perf, funnel, daily, projection, signals, leading indicators)
   └─ app_*  tasks, assumptions, pending AI actions, activity log
```

```
app/                 pages (Overview, Campaigns, Tasks, Targets & data, Setup) and API routes
lib/                 db, queries, setup, formatting, copilot (agent, tools, prompt, SQL guard, calculator)
db/                  01 schema · 02 views · 03 metrics · 04 assumptions
data/source/         original RISA dataset (unchanged)
data/seed/           the same rows as JSON (scripts/build_seed.py), loaded by /setup
analysis/            pandas reference, SQL cross-check, changed-data tests, model evidence, Slide 1 prototype
tests/               copilot tests (23), API flow tests (13)
docs/METRICS.md      metric definitions
```

---

## 9. Deploy (in about 15 minutes)

You need three free accounts: **Supabase** (database), **Google AI Studio** (Gemini key) and **Vercel** (hosting), plus this repo on GitHub.

**Shortest path:** import the repo in Vercel, then in the project go to **Storage → Create Database → Supabase** (Mumbai region) and connect it. Vercel sets `POSTGRES_URL` automatically, and the app uses it when `DATABASE_URL` is absent. Add `GEMINI_API_KEY` and `ADMIN_TOKEN`, redeploy, and open `/setup`; the first initialise of an empty database needs no token. The manual route is below.

1. **Database.** On supabase.com, create a **New project** in the **Mumbai (ap-south-1)** region and set a database password. Then open **Connect → Transaction pooler** and copy the URI (port 6543), replacing `[YOUR-PASSWORD]`. This is your `DATABASE_URL`.
2. **Gemini key.** In aistudio.google.com, go to **Get API key → Create API key**. This is your `GEMINI_API_KEY`.
3. **Hosting.** In vercel.com, go to **Add New → Project** and import the GitHub repo. Under **Environment Variables**, add:
   - `DATABASE_URL`: from step 1
   - `GEMINI_API_KEY`: from step 2
   - `ADMIN_TOKEN`: any long random string
   - `GEMINI_MODEL` (optional): defaults to `gemini-flash-latest`

   Then press **Deploy**.
4. **Initialise.** Open `https://<your-app>.vercel.app/setup`, enter the `ADMIN_TOKEN` and press **Initialise database**. This creates the schema and loads the original 27,969 rows. Then press **Test AI connection**; it should show "Gemini replied".
5. Open `/` and you're live.

The function region is set to Mumbai (`vercel.json`) to sit next to a Mumbai Supabase project; change both together if you pick another region.

**Notes**
- Supabase free projects pause after a week without traffic. Open the app shortly before it is reviewed.
- The free Gemini tier is rate-limited. If you see a rate-limit message, wait a minute.

**Local development**
```bash
npm install
cp .env.example .env.local        # fill DATABASE_URL (local Postgres works), GEMINI_API_KEY, ADMIN_TOKEN
npm run db:setup                  # schema + original data
npm run dev                       # http://localhost:3000
```

---

## 10. Testing

```bash
DATABASE_URL=... npm run test:copilot                                   # 23 tests: tools on live data, SQL guard, calculator, agent loop
BASE_URL=http://localhost:3000 DATABASE_URL=... ADMIN_TOKEN=... npm run test:api   # 13 end-to-end edit → analytics flows
python analysis/crosscheck_sql_vs_pandas.py "data/source/Attendee Dataset.xlsx"  # SQL vs pandas, 8 dates
psql "$DATABASE_URL" -f analysis/test_changed_data.sql                  # 9 changed-data tests (rolled back)
```
- **The agent-loop tests** use a scripted stand-in for Gemini. They check that tools run, thought signatures and call ids are sent back unchanged, tool errors reach the model, thought text never leaks into replies, and proposals need confirmation.
- **The API flow tests** check that:
  - a new daily entry changes spend only from its date onward
  - corrections replace and roll back cleanly
  - source rows can't be deleted
  - campaign, task and target edits persist and are logged
  - assumptions change projections reversibly
  - an AI proposal changes nothing until it is confirmed, and can be confirmed only once
  - reset restores the original data and keeps tasks
- **Not covered here:** live Gemini calls (the build environment had no network access to Google). Use `/setup → Test AI connection` after deploying.

---

## 11. Tools used

| Tool | Plan | Used for |
|---|---|---|
| Next.js 16, React 19, TypeScript | open source | web app and API |
| Recharts | open source | charts |
| node-postgres (`pg`) | open source | database access |
| PostgreSQL on Supabase | Free | database (SQL functions do the analytics) |
| Google Gemini API (`gemini-flash-latest`) | Free tier | AI analyst |
| Vercel | Hobby | hosting |
| Python, pandas, Playwright | open source | independent verification, screenshots |

Nothing was copied from templates. All code, SQL and analysis are specific to this assignment, and verified as described in §3 and §10.

---

## 12. Known limitations

- **Fictional, historical data.** The dashboard is "live" over the 2025 dataset. New data enters by manual entry; there is no ad-platform or ticketing integration.
- **Projection** is a simple run-rate × assumed show rate + assumed walk-ins. It doesn't model the late-registration surge, so it is conservative early in the campaign.
- **Attribution** is observational (registration source). Lever impacts in the model are estimates; the plan measures them with holdouts and A/B tests rather than assuming them.
- **Model assumptions** (1.5× marginal cost, engagement uplift, sponsor reach, venue capacity) are judgement. They are labelled, editable, and covered by the sensitivity range.
- **No user accounts.** Anyone with the link can edit tasks and campaigns, so the demo can be tested freely. Reset needs the admin token, and every change is logged.
- **The AI can still be wrong.** Every answer shows the tools and dates it used, numbers come from tools, and nothing changes without a click. Free-tier rate limits apply.
- **The ad-hoc SQL guard** is a keyword filter backed by a read-only transaction. That is fine for a demo; production would use a dedicated read-only database role.
- **Chat history** is stored in the browser only.
