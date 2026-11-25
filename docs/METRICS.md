# Metric definitions (Challenge A — Attendee Growth)

Every metric is computed **as of a selected date** = end of that day in IST (Asia/Kolkata).
Nothing dated after the cutoff can affect an earlier snapshot.

| Metric | Definition | Source rule |
|---|---|---|
| Identified external people | Distinct `person_id` with `person_type = 'external'` and `first_seen_at` ≤ cutoff | Targets apply to external people only |
| Registered external people | Distinct external `person_id` with a registration created (`registered_at`) ≤ cutoff. Counts people, not registration records | "A new registration or status version is not a new person" |
| Confirmed / waitlisted / cancelled | Latest `registration_history` version effective ≤ cutoff, per registration | "Choose latest eligible version; do not sum history states" |
| Unique external visitors | Distinct external `person_id` with ≥1 check-in where `result = 'admitted'` **and** `verification = 'verified'`, ≤ cutoff | "Only admitted+verified establish a verified admission" |
| Walk-in visitors | Visitors with no registration ≤ cutoff | External walk-ins can have no campaign or registration |
| Verified admission events | Count of admitted+verified check-in events (one person can have several across two days) | Not a people count |
| Marketing spend | Sum of net `marketing_spend_inr` with `activity_date` ≤ selected date (credits are negative) | Available at end of activity date |
| Budget / goals | Latest target version with `effective_at` ≤ cutoff | Targets change over time |
| Show rate | Registered visitors ÷ registered external people | Observed only after the event |
| Cost per registration (CPR) | Spend ÷ registered external people | |
| Cost per visitor (CPV) | Spend ÷ unique external visitors (overall), or ÷ attributed visitors (per campaign) | |

**Never summed into people:** impressions, clicks, reported reach, landing-page sessions, anonymous form starts.
These are event counts.

## Attribution (documented choice)
- **Registration source** (primary): a registration's `campaign_id` is the recorded acquisition source.
- **Visitors** inherit the campaign of their earliest registration. Visitors with no registration are
  `Walk-in / unattributed`.
- **First touch** (alternative): `people.first_campaign_id`, used for the "identified people" stage.
- Attribution is observational. It is not proof that a campaign *caused* attendance.

## Deduplication
Source tables keep every raw row (`src_*`). Clean views (`v_*`) keep one row per stable ID.
In the supplied file: 2 daily-marketing, 4 registration-history and 20 check-in rows are import copies.

## Projection (pre-event only)
`projected registrations = registered now + (trailing 14-day daily registrations × days to event)`
`projected visitors = projected registrations × expected_show_rate + expected_walk_ins`
Both `expected_*` values are **assumptions** stored in `app_assumptions`, shown in the UI and editable.

## Scale / fix / stop signals
Efficiency metric = CPR before the event, CPV once attendance exists, compared with the blended value.
- `insufficient data` if < 30 registrations
- `stop` if ≥ 1.75× blended
- `fix` if opt-out rate > 10% of engaged people, or cancellation rate > 1.5× blended
- `scale` if ≤ 0.80× blended
- otherwise `hold`

All thresholds are assumptions in `app_assumptions`.

## Verification
- `analysis/crosscheck_sql_vs_pandas.py`: SQL vs an independent pandas implementation at 8 dates (all match).
- `analysis/test_changed_data.sql`: 9 changed-data tests (duplicates, repeat admissions, pending, staff,
  future-dated status, credits, target versions). All pass.

## Leading indicators (`f_leading_indicators(date)`, Slide 3)
| Indicator | Good | Alert | Linked bet |
|---|---|---|---|
| New registrations, last 7 days vs previous 7 | ≥ previous week | < 80% of previous week | all |
| Engaged share of registrants (brochure, question or email click) | ≥ 75% | < 60% | 3 Show-up engine |
| Referral share of new registrations (14 days) | ≥ 20% | < 12% | 2 Squad referrals |
| Opt-out rate (engaged people) | ≤ 7% | > 10% | guardrail |
| Cancellation rate | ≤ 5.6% | > 8% | guardrail |
| People stuck on the waitlist | 0 | > 0 while cancellations exist | 3 Show-up engine |
| Projected visitors vs goal | ≥ 100% | < 95% | all |
| Budget pace (share of budget spent − share of window elapsed) | ≤ +5 pts | > +15 pts | budget |

Targets and alert levels are rows in `app_assumptions`, editable in the app.
