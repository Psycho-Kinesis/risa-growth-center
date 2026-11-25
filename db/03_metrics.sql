-- =====================================================================
-- Metric layer. Every metric is a function of an as-of DATE.
--
-- Source rules implemented here (from the dataset's Read me / Field guide):
--   R1  A selected date means END of that day in Asia/Kolkata.
--   R2  History tables: use the latest version effective <= cutoff.
--       Never sum history states. No later outcome leaks into earlier dates.
--   R3  Import-retry duplicates count once (handled by v_* views).
--   R4  Targets apply to EXTERNAL people only (exclude internal/staff/test).
--   R5  Attendance = distinct person with a check-in that is
--       result='admitted' AND verification='verified'. Pending/unverified/
--       denied do not count. Several admissions by one person count once.
--   R6  Anonymous daily counts (impressions, clicks, reach, sessions,
--       form starts) are NOT people and are never summed into people.
--   R7  Campaign spend = net posted ledger amount (credits are negative),
--       available at end of activity_date.
--   R8  Attribution (documented choice): a registration's campaign_id is
--       the recorded acquisition source. Visitors are attributed through
--       their earliest registration. Visitors with no registration are
--       'walk-in / unattributed'. First-touch (people.first_campaign_id)
--       is offered as an alternative view for identified people.
-- =====================================================================

create or replace function f_cutoff(p_as_of date) returns timestamptz
language sql immutable as $$
  select ((p_as_of + 1)::timestamp at time zone 'Asia/Kolkata')
$$;

create or replace function f_ist_date(p_ts timestamptz) returns date
language sql immutable as $$
  select (p_ts at time zone 'Asia/Kolkata')::date
$$;

create or replace function f_assumption(p_key text, p_default numeric) returns numeric
language sql stable as $$
  select coalesce((select value from app_assumptions where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------
-- Targets in force at the as-of date
-- ---------------------------------------------------------------------
create or replace function f_targets(p_as_of date)
returns table (
  target_version text, effective_at timestamptz,
  identified_external_people_goal int, registration_goal int,
  unique_external_visitors_goal int, marketing_budget_inr bigint)
language sql stable as $$
  select t.target_version, t.effective_at, t.identified_external_people_goal,
         t.registration_goal, t.unique_external_visitors_goal, t.marketing_budget_inr
  from src_targets t
  where t.effective_at < f_cutoff(p_as_of)
  order by t.effective_at desc, t._row desc
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Snapshot building blocks
-- ---------------------------------------------------------------------
-- Registrations created by the cutoff, with the status in force at the cutoff.
create or replace function f_registrations_asof(p_as_of date)
returns table (
  registration_id text, person_id text, person_type text, campaign_id text,
  registered_at timestamptz, status text, status_effective_at timestamptz)
language sql stable as $$
  with r as (
    select r.registration_id, r.person_id, r.campaign_id, r.registered_at
    from v_registrations r
    where r.registered_at < f_cutoff(p_as_of)
  ), h as (
    select distinct on (h.registration_id) h.registration_id, h.status, h.effective_at
    from v_registration_history h
    where h.effective_at < f_cutoff(p_as_of)
    order by h.registration_id, h.effective_at desc, h.history_id desc
  )
  select r.registration_id, r.person_id, p.person_type, r.campaign_id, r.registered_at,
         coalesce(h.status, 'no_status_yet'), h.effective_at
  from r
  left join h on h.registration_id = r.registration_id
  left join v_people p on p.person_id = r.person_id
$$;

-- Verified unique visitors by the cutoff, with attribution.
create or replace function f_visitors_asof(p_as_of date)
returns table (
  person_id text, person_type text, first_admitted_at timestamptz,
  admission_events bigint, registration_id text, attributed_campaign_id text,
  is_walk_in boolean)
language sql stable as $$
  with adm as (
    select c.person_id, min(c.occurred_at) as first_admitted_at, count(*) as admission_events
    from v_checkins c
    where c.result = 'admitted' and c.verification = 'verified'
      and c.occurred_at < f_cutoff(p_as_of)
    group by c.person_id
  )
  , fr as (  -- earliest registration per person by the cutoff (set-based: fast without table statistics)
    select distinct on (r.person_id) r.person_id, r.registration_id, r.campaign_id
    from v_registrations r
    where r.registered_at < f_cutoff(p_as_of)
    order by r.person_id, r.registered_at asc, r.registration_id asc
  )
  select a.person_id, p.person_type, a.first_admitted_at, a.admission_events,
         fr.registration_id, fr.campaign_id, (fr.registration_id is null)
  from adm a
  left join v_people p on p.person_id = a.person_id
  left join fr on fr.person_id = a.person_id
$$;

-- ---------------------------------------------------------------------
-- Headline KPIs vs targets
-- ---------------------------------------------------------------------
create or replace function f_overview(p_as_of date)
returns table (
  as_of date, target_version text, event_phase text, days_to_event int,
  identified_external_people bigint, identified_goal int, pct_identified_goal numeric,
  registered_external_people bigint, registration_goal int, pct_registration_goal numeric,
  confirmed_external_people bigint, waitlisted_external_people bigint,
  cancelled_external_people bigint, interested_external_people bigint,
  unique_external_visitors bigint, visitors_goal int, pct_visitors_goal numeric,
  registered_visitors bigint, walk_in_visitors bigint, verified_admission_events bigint,
  spend_inr bigint, budget_inr bigint, pct_budget_used numeric,
  cost_per_registration numeric, cost_per_visitor numeric, show_rate numeric)
language sql stable as $$
  with t as (select * from f_targets(p_as_of)),
  ev as (select * from src_event limit 1),
  ppl as (
    select count(distinct person_id) n from v_people
    where person_type = 'external' and first_seen_at < f_cutoff(p_as_of)
  ),
  reg as (
    select count(distinct person_id) as registered,
           count(distinct person_id) filter (where status = 'confirmed')   as confirmed,
           count(distinct person_id) filter (where status = 'waitlisted')  as waitlisted,
           count(distinct person_id) filter (where status = 'cancelled')   as cancelled,
           count(distinct person_id) filter (where status = 'interested')  as interested
    from f_registrations_asof(p_as_of) where person_type = 'external'
  ),
  vis as (
    select count(*) as visitors,
           count(*) filter (where not is_walk_in) as registered_visitors,
           count(*) filter (where is_walk_in)     as walk_ins,
           coalesce(sum(admission_events), 0)     as admission_events
    from f_visitors_asof(p_as_of) where person_type = 'external'
  ),
  sp as (
    select coalesce(sum(marketing_spend_inr), 0)::bigint as spend
    from v_campaign_daily where activity_date <= p_as_of
  )
  select p_as_of, t.target_version,
         case when f_cutoff(p_as_of) <= ev.event_starts_at then 'pre-event'
              when p_as_of <= f_ist_date(ev.event_ends_at) then 'event-days'
              else 'post-event' end,
         greatest(f_ist_date(ev.event_starts_at) - p_as_of, 0),
         ppl.n, t.identified_external_people_goal,
         round(100.0 * ppl.n / nullif(t.identified_external_people_goal, 0), 1),
         reg.registered, t.registration_goal,
         round(100.0 * reg.registered / nullif(t.registration_goal, 0), 1),
         reg.confirmed, reg.waitlisted, reg.cancelled, reg.interested,
         vis.visitors, t.unique_external_visitors_goal,
         round(100.0 * vis.visitors / nullif(t.unique_external_visitors_goal, 0), 1),
         vis.registered_visitors, vis.walk_ins, vis.admission_events,
         sp.spend, t.marketing_budget_inr,
         round(100.0 * sp.spend / nullif(t.marketing_budget_inr, 0), 1),
         round(sp.spend::numeric / nullif(reg.registered, 0), 1),
         round(sp.spend::numeric / nullif(vis.visitors, 0), 1),
         round(vis.registered_visitors::numeric / nullif(reg.registered, 0), 4)
  from ppl, reg, vis, sp, ev
  left join t on true
$$;

-- ---------------------------------------------------------------------
-- Campaign performance (one row per campaign + unattributed walk-ins)
-- ---------------------------------------------------------------------
create or replace function f_campaign_perf(p_as_of date)
returns table (
  campaign_id text, campaign_name text, channel text, owner_name text, status text,
  planned_budget_inr bigint,
  impressions bigint, clicks bigint, sessions bigint, form_starts_anon bigint,
  spend_inr bigint,
  identified_people_first_touch bigint, engaged_people bigint, reg_start_people bigint,
  registered_people bigint, confirmed_people bigint, waitlisted_people bigint,
  cancelled_people bigint, visitors bigint,
  opt_out_people bigint, emails_sent bigint, emails_opened bigint, emails_clicked bigint,
  ctr numeric, session_to_registration numeric, registration_to_visit numeric,
  cancel_rate numeric, opt_out_rate numeric,
  cost_per_registration numeric, cost_per_visitor numeric,
  spend_share numeric, registration_share numeric, visitor_share numeric)
language sql stable as $$
  with c as (
    select campaign_id, campaign_name, channel, owner_name, status, planned_budget_inr
    from src_campaigns
    union all
    select null, 'Walk-in / unattributed', 'none', null, null, null
  ),
  d as (
    select campaign_id,
           sum(impressions)::bigint im, sum(clicks)::bigint cl,
           sum(landing_page_sessions)::bigint se, sum(registration_starts)::bigint fs,
           sum(marketing_spend_inr)::bigint sp
    from v_campaign_daily where activity_date <= p_as_of
    group by campaign_id
  ),
  pft as (
    select first_campaign_id as campaign_id, count(distinct person_id) n
    from v_people
    where person_type = 'external' and first_seen_at < f_cutoff(p_as_of)
    group by first_campaign_id
  ),
  li as (
    select i.campaign_id,
           count(distinct i.person_id) as engaged,
           count(distinct i.person_id) filter (where i.event_type = 'registration_start') as rs,
           count(distinct i.person_id) filter (where i.event_type = 'opted_out') as oo,
           count(*) filter (where i.event_type = 'nurture_email_sent')    as es,
           count(*) filter (where i.event_type = 'nurture_email_opened')  as eo,
           count(*) filter (where i.event_type = 'nurture_email_clicked') as ec
    from v_lead_interactions i
    join v_people p on p.person_id = i.person_id and p.person_type = 'external'
    where i.occurred_at < f_cutoff(p_as_of)
    group by i.campaign_id
  ),
  r as (
    select campaign_id,
           count(distinct person_id) reg,
           count(distinct person_id) filter (where status = 'confirmed')  conf,
           count(distinct person_id) filter (where status = 'waitlisted') wait,
           count(distinct person_id) filter (where status = 'cancelled')  canc
    from f_registrations_asof(p_as_of) where person_type = 'external'
    group by campaign_id
  ),
  v as (
    select attributed_campaign_id as campaign_id, count(*) vis
    from f_visitors_asof(p_as_of) where person_type = 'external'
    group by attributed_campaign_id
  ),
  base as (
    select c.campaign_id, c.campaign_name, c.channel, c.owner_name, c.status, c.planned_budget_inr,
           coalesce(d.im,0) im, coalesce(d.cl,0) cl, coalesce(d.se,0) se, coalesce(d.fs,0) fs,
           coalesce(d.sp,0) sp,
           coalesce(pft.n,0) pft, coalesce(li.engaged,0) engaged, coalesce(li.rs,0) rs,
           coalesce(r.reg,0) reg, coalesce(r.conf,0) conf, coalesce(r.wait,0) wait,
           coalesce(r.canc,0) canc, coalesce(v.vis,0) vis,
           coalesce(li.oo,0) oo, coalesce(li.es,0) es, coalesce(li.eo,0) eo, coalesce(li.ec,0) ec
    from c
    left join d   on d.campaign_id   is not distinct from c.campaign_id
    left join pft on pft.campaign_id is not distinct from c.campaign_id
    left join li  on li.campaign_id  is not distinct from c.campaign_id
    left join r   on r.campaign_id   is not distinct from c.campaign_id
    left join v   on v.campaign_id   is not distinct from c.campaign_id
  ),
  tot as (select sum(sp) sp, sum(reg) reg, sum(vis) vis from base)
  select b.campaign_id, b.campaign_name, b.channel, b.owner_name, b.status, b.planned_budget_inr,
         b.im, b.cl, b.se, b.fs, b.sp,
         b.pft, b.engaged, b.rs, b.reg, b.conf, b.wait, b.canc, b.vis,
         b.oo, b.es, b.eo, b.ec,
         round(b.cl::numeric  / nullif(b.im, 0), 4),
         round(b.reg::numeric / nullif(b.se, 0), 4),
         round(b.vis::numeric / nullif(b.reg, 0), 4),
         round(b.canc::numeric / nullif(b.reg, 0), 4),
         round(b.oo::numeric  / nullif(b.engaged, 0), 4),
         round(b.sp::numeric  / nullif(b.reg, 0), 1),
         round(b.sp::numeric  / nullif(b.vis, 0), 1),
         round(b.sp::numeric  / nullif(tot.sp, 0), 4),
         round(b.reg::numeric / nullif(tot.reg, 0), 4),
         round(b.vis::numeric / nullif(tot.vis, 0), 4)
  from base b, tot
  where b.campaign_id is not null or b.vis > 0 or b.pft > 0
  order by b.campaign_id nulls last
$$;

-- ---------------------------------------------------------------------
-- Daily trend (optionally for one campaign)
-- ---------------------------------------------------------------------
create or replace function f_daily(p_as_of date, p_campaign_id text default null)
returns table (
  day date, spend_inr bigint, impressions bigint, clicks bigint, sessions bigint,
  new_identified bigint, new_registrations bigint, new_visitors bigint,
  cum_spend_inr bigint, cum_identified bigint, cum_registrations bigint, cum_visitors bigint)
language sql stable as $$
  with days as (
    select generate_series((select history_start from src_event limit 1), p_as_of, interval '1 day')::date as day
  ),
  d as (
    select activity_date as day, sum(marketing_spend_inr)::bigint sp, sum(impressions)::bigint im,
           sum(clicks)::bigint cl, sum(landing_page_sessions)::bigint se
    from v_campaign_daily
    where activity_date <= p_as_of and (p_campaign_id is null or campaign_id = p_campaign_id)
    group by activity_date
  ),
  idf as (
    select f_ist_date(first_seen_at) as day, count(*) n
    from v_people
    where person_type = 'external' and first_seen_at < f_cutoff(p_as_of)
      and (p_campaign_id is null or first_campaign_id = p_campaign_id)
    group by 1
  ),
  rg as (
    select f_ist_date(first_reg) as day, count(*) n
    from (select person_id, min(registered_at) first_reg
          from f_registrations_asof(p_as_of)
          where person_type = 'external' and (p_campaign_id is null or campaign_id = p_campaign_id)
          group by person_id) x
    group by 1
  ),
  vs as (
    select f_ist_date(first_admitted_at) as day, count(*) n
    from f_visitors_asof(p_as_of)
    where person_type = 'external' and (p_campaign_id is null or attributed_campaign_id = p_campaign_id)
    group by 1
  )
  select days.day,
         coalesce(d.sp,0), coalesce(d.im,0), coalesce(d.cl,0), coalesce(d.se,0),
         coalesce(idf.n,0), coalesce(rg.n,0), coalesce(vs.n,0),
         sum(coalesce(d.sp,0))  over w, sum(coalesce(idf.n,0)) over w,
         sum(coalesce(rg.n,0))  over w, sum(coalesce(vs.n,0))  over w
  from days
  left join d   on d.day   = days.day
  left join idf on idf.day = days.day
  left join rg  on rg.day  = days.day
  left join vs  on vs.day  = days.day
  window w as (order by days.day)
  order by days.day
$$;

-- ---------------------------------------------------------------------
-- Funnel (overall or one campaign)
-- ---------------------------------------------------------------------
create or replace function f_funnel(p_as_of date, p_campaign_id text default null)
returns table (stage_order int, stage text, unit text, value bigint, conversion_from_previous numeric)
language sql stable as $$
  with s as (
    select 1 o, 'Impressions' stage, 'anonymous events' unit,
           coalesce(sum(impressions),0)::bigint v
      from v_campaign_daily where activity_date <= p_as_of and (p_campaign_id is null or campaign_id = p_campaign_id)
    union all
    select 2, 'Clicks', 'anonymous events', coalesce(sum(clicks),0)::bigint
      from v_campaign_daily where activity_date <= p_as_of and (p_campaign_id is null or campaign_id = p_campaign_id)
    union all
    select 3, 'Landing-page sessions', 'anonymous sessions', coalesce(sum(landing_page_sessions),0)::bigint
      from v_campaign_daily where activity_date <= p_as_of and (p_campaign_id is null or campaign_id = p_campaign_id)
    union all
    select 4, 'Identified people', 'distinct external people (first touch)', count(distinct person_id)
      from v_people where person_type = 'external' and first_seen_at < f_cutoff(p_as_of)
       and (p_campaign_id is null or first_campaign_id = p_campaign_id)
    union all
    select 5, 'Registered', 'distinct external people', count(distinct person_id)
      from f_registrations_asof(p_as_of) where person_type = 'external'
       and (p_campaign_id is null or campaign_id = p_campaign_id)
    union all
    select 6, 'Confirmed (latest status)', 'distinct external people', count(distinct person_id)
      from f_registrations_asof(p_as_of) where person_type = 'external' and status = 'confirmed'
       and (p_campaign_id is null or campaign_id = p_campaign_id)
    union all
    select 7, 'Attended (verified)', 'distinct external people', count(*)
      from f_visitors_asof(p_as_of) where person_type = 'external'
       and (p_campaign_id is null or attributed_campaign_id = p_campaign_id)
  )
  select o, stage, unit, v,
         round(v::numeric / nullif(lag(v) over (order by o), 0), 4)
  from s order by o
$$;

-- ---------------------------------------------------------------------
-- Projection to event day (run-rate x days remaining; assumptions explicit)
-- ---------------------------------------------------------------------
create or replace function f_projection(p_as_of date)
returns table (
  as_of date, event_phase text, days_to_event int, window_days int,
  registrations_now bigint, daily_registration_runrate numeric, projected_registrations numeric,
  show_rate_used numeric, show_rate_basis text, walk_ins_used numeric,
  visitors_now bigint, projected_visitors numeric, visitors_goal int, projected_gap_to_goal numeric,
  spend_now bigint, daily_spend_runrate numeric, projected_spend numeric, budget_inr bigint,
  projected_budget_headroom numeric)
language sql stable as $$
  with o as (select * from f_overview(p_as_of)),
  w as (select greatest(f_assumption('runrate_window_days', 14)::int, 1) n),
  rr as (
    select sum(new_registrations)::numeric / (select n from w) reg_rr,
           sum(spend_inr)::numeric / (select n from w) sp_rr
    from f_daily(p_as_of) where day > p_as_of - (select n from w)
  ),
  a as (select f_assumption('expected_show_rate', 0.65) sr, f_assumption('expected_walk_ins', 100) wi)
  select o.as_of, o.event_phase, o.days_to_event, (select n from w),
         o.registered_external_people, round(rr.reg_rr, 1),
         case when o.event_phase = 'pre-event'
              then round(o.registered_external_people + rr.reg_rr * o.days_to_event, 0)
              else o.registered_external_people::numeric end,
         case when o.event_phase = 'pre-event' then a.sr else o.show_rate end,
         case when o.event_phase = 'pre-event' then 'assumption (app_assumptions.expected_show_rate)'
              else 'observed' end,
         case when o.event_phase = 'pre-event' then a.wi else o.walk_in_visitors::numeric end,
         o.unique_external_visitors,
         case when o.event_phase = 'pre-event'
              then round((o.registered_external_people + rr.reg_rr * o.days_to_event) * a.sr + a.wi, 0)
              else o.unique_external_visitors::numeric end,
         o.visitors_goal,
         case when o.event_phase = 'pre-event'
              then round((o.registered_external_people + rr.reg_rr * o.days_to_event) * a.sr + a.wi - o.visitors_goal, 0)
              else (o.unique_external_visitors - o.visitors_goal)::numeric end,
         o.spend_inr, round(rr.sp_rr, 0),
         case when o.event_phase = 'pre-event' then round(o.spend_inr + rr.sp_rr * o.days_to_event, 0)
              else o.spend_inr::numeric end,
         o.budget_inr,
         case when o.event_phase = 'pre-event' then round(o.budget_inr - (o.spend_inr + rr.sp_rr * o.days_to_event), 0)
              else (o.budget_inr - o.spend_inr)::numeric end
  from o, rr, a
$$;

-- ---------------------------------------------------------------------
-- Scale / fix / stop signals per campaign (thresholds are assumptions)
-- Pre-event the efficiency metric is cost per registration; once
-- attendance exists it switches to cost per verified visitor.
-- ---------------------------------------------------------------------
create or replace function f_campaign_signals(p_as_of date)
returns table (
  campaign_id text, campaign_name text, metric text, campaign_value numeric,
  blended_value numeric, efficiency_index numeric, cancel_rate numeric,
  opt_out_rate numeric, registrations bigint, signal text, reason text)
language sql stable as $$
  with p as (select * from f_campaign_perf(p_as_of) where campaign_id is not null),
  ov as (select * from f_overview(p_as_of)),
  th as (
    select f_assumption('signal_scale_index', 0.80) scale_i,
           f_assumption('signal_stop_index', 1.75)  stop_i,
           f_assumption('signal_min_registrations', 30) min_n,
           f_assumption('signal_cancel_rate_ratio', 1.5) canc_ratio,
           f_assumption('signal_max_opt_out_rate', 0.10) max_oo
  ),
  bl as (
    select case when (select unique_external_visitors from ov) > 0
                then 'cost_per_visitor' else 'cost_per_registration' end metric,
           sum(spend_inr)::numeric / nullif(case when (select unique_external_visitors from ov) > 0
                                                 then sum(visitors) else sum(registered_people) end, 0) blended,
           sum(cancelled_people)::numeric / nullif(sum(registered_people), 0) blended_cancel
    from p
  ),
  x as (
    select p.*, bl.metric, bl.blended, bl.blended_cancel,
           case when bl.metric = 'cost_per_visitor' then p.cost_per_visitor else p.cost_per_registration end val
    from p, bl
  )
  select x.campaign_id, x.campaign_name, x.metric, x.val, round(x.blended, 1),
         round(x.val / nullif(x.blended, 0), 2), x.cancel_rate, x.opt_out_rate, x.registered_people,
         case
           when x.registered_people < th.min_n then 'insufficient data'
           when x.val / nullif(x.blended, 0) >= th.stop_i then 'stop'
           when x.opt_out_rate > th.max_oo then 'fix'
           when x.cancel_rate > th.canc_ratio * x.blended_cancel then 'fix'
           when x.val / nullif(x.blended, 0) <= th.scale_i then 'scale'
           else 'hold'
         end,
         case
           when x.registered_people < th.min_n then
             format('Only %s registrations (< %s) — too few to judge.', x.registered_people, th.min_n)
           when x.val / nullif(x.blended, 0) >= th.stop_i then
             format('%s ₹%s is %sx the blended ₹%s (stop threshold %sx).',
                    x.metric, round(x.val), round(x.val / x.blended, 2), round(x.blended), th.stop_i)
           when x.opt_out_rate > th.max_oo then
             format('Opt-out rate %s%% exceeds %s%% of engaged people.',
                    round(100 * x.opt_out_rate, 1), round(100 * th.max_oo))
           when x.cancel_rate > th.canc_ratio * x.blended_cancel then
             format('Cancellation rate %s%% is above %sx the blended %s%%.',
                    round(100 * x.cancel_rate, 1), th.canc_ratio, round(100 * x.blended_cancel, 1))
           when x.val / nullif(x.blended, 0) <= th.scale_i then
             format('%s ₹%s is %sx the blended ₹%s (scale threshold %sx).',
                    x.metric, round(x.val), round(x.val / x.blended, 2), round(x.blended), th.scale_i)
           else
             format('%s ₹%s is within %s–%sx of blended ₹%s.',
                    x.metric, round(x.val), th.scale_i, th.stop_i, round(x.blended))
         end
  from x, th
  order by x.val / nullif(x.blended, 0) nulls last
$$;

-- ---------------------------------------------------------------------
-- Leading indicators (the early-warning signals on Slide 3).
-- Each row: value, the threshold it is judged against, and a status
-- of good / watch / alert. Thresholds live in app_assumptions.
-- ---------------------------------------------------------------------
create or replace function f_leading_indicators(p_as_of date)
returns table (
  indicator text, value numeric, unit text, target numeric, alert_level numeric,
  status text, linked_bet text, note text)
language sql stable as $$
  with co as (select f_cutoff(p_as_of) c),
  ev as (select * from src_event limit 1),
  reg as (select * from f_registrations_asof(p_as_of) where person_type = 'external'),
  first_reg as (
    select person_id, min(registered_at) first_at,
           (array_agg(campaign_id order by registered_at))[1] campaign_id
    from reg group by person_id
  ),
  w as (
    select count(*) filter (where f_ist_date(first_at) > p_as_of - 7) last7,
           count(*) filter (where f_ist_date(first_at) > p_as_of - 14 and f_ist_date(first_at) <= p_as_of - 7) prev7,
           count(*) filter (where f_ist_date(first_at) > p_as_of - 14) last14,
           count(*) filter (where f_ist_date(first_at) > p_as_of - 14 and c.channel = 'referrals') ref14
    from first_reg fr left join src_campaigns c on c.campaign_id = fr.campaign_id
  ),
  engaged_people as (
    select distinct i.person_id from v_lead_interactions i
    where i.occurred_at < (select c from co)
      and i.event_type in ('brochure_download','event_question_submitted','nurture_email_clicked')
  ),
  eng as (
    select count(distinct r.person_id) regs,
           count(distinct r.person_id) filter (where e.person_id is not null) engaged
    from reg r left join engaged_people e on e.person_id = r.person_id
  ),
  oo as (
    select count(distinct i.person_id) filter (where i.event_type = 'opted_out') opted,
           count(distinct i.person_id) engaged
    from v_lead_interactions i join v_people p on p.person_id = i.person_id and p.person_type = 'external'
    where i.occurred_at < (select c from co)
  ),
  st as (
    select count(distinct person_id) regs,
           count(distinct person_id) filter (where status = 'cancelled')  canc,
           count(distinct person_id) filter (where status = 'waitlisted') wait
    from reg
  ),
  pr as (select * from f_projection(p_as_of)),
  ov as (select * from f_overview(p_as_of)),
  pace as (
    select ov.spend_inr::numeric / nullif(ov.budget_inr, 0) spent_share,
           least(greatest((p_as_of - ev.history_start)::numeric
                 / nullif(f_ist_date(ev.event_starts_at) - ev.history_start, 0), 0), 1) time_share
    from ov, ev
  ),
  a as (
    select f_assumption('target_engaged_share', 0.75) eng_t, f_assumption('alert_engaged_share', 0.60) eng_a,
           f_assumption('target_referral_share', 0.20) ref_t, f_assumption('alert_referral_share', 0.12) ref_a,
           f_assumption('signal_max_opt_out_rate', 0.10) oo_a, f_assumption('max_cancel_rate', 0.08) canc_a
  )
  select 'New registrations, last 7 days', w.last7::numeric, 'people', w.prev7::numeric, round(0.8 * w.prev7),
         case when (select event_phase from ov) <> 'pre-event' then 'n/a'
              when w.last7 >= w.prev7 then 'good' when w.last7 >= 0.8 * w.prev7 then 'watch' else 'alert' end,
         'All bets', format('Previous 7 days: %s. Alert if below 80%% of that.', w.prev7)
  from w
  union all
  select 'Engaged share of registrants', round(eng.engaged::numeric / nullif(eng.regs, 0), 4), 'ratio', a.eng_t, a.eng_a,
         case when eng.regs = 0 then 'n/a'
              when eng.engaged::numeric / eng.regs >= a.eng_t then 'good'
              when eng.engaged::numeric / eng.regs >= a.eng_a then 'watch' else 'alert' end,
         'S3 Show-up engine',
         'Brochure download, question or email click. 2025: engaged registrants showed up 73-79% vs 62% for the rest.'
  from eng, a
  union all
  select 'Referral share of new registrations (14 days)', round(w.ref14::numeric / nullif(w.last14, 0), 4), 'ratio', a.ref_t, a.ref_a,
         case when w.last14 = 0 then 'n/a'
              when w.ref14::numeric / w.last14 >= a.ref_t then 'good'
              when w.ref14::numeric / w.last14 >= a.ref_a then 'watch' else 'alert' end,
         'S1 Squad referrals', format('%s of %s new registrations came through referrals.', w.ref14, w.last14)
  from w, a
  union all
  select 'Opt-out rate (engaged people)', round(oo.opted::numeric / nullif(oo.engaged, 0), 4), 'ratio', null, a.oo_a,
         case when oo.engaged = 0 then 'n/a'
              when oo.opted::numeric / oo.engaged > a.oo_a then 'alert'
              when oo.opted::numeric / oo.engaged > 0.7 * a.oo_a then 'watch' else 'good' end,
         'Guardrail', 'Over-contacting people burns future reach.'
  from oo, a
  union all
  select 'Cancellation rate (registrants)', round(st.canc::numeric / nullif(st.regs, 0), 4), 'ratio', null, a.canc_a,
         case when st.regs = 0 then 'n/a'
              when st.canc::numeric / st.regs > a.canc_a then 'alert'
              when st.canc::numeric / st.regs > 0.7 * a.canc_a then 'watch' else 'good' end,
         'Guardrail', format('%s cancelled of %s registered.', st.canc, st.regs)
  from st, a
  union all
  select 'People stuck on the waitlist', st.wait::numeric, 'people', 0, 1,
         case when st.wait > 0 and st.canc > 0 then 'alert' when st.wait > 0 then 'watch' else 'good' end,
         'S3 Show-up engine',
         format('%s waitlisted while %s cancellations freed seats. In 2025 no waitlisted person attended.', st.wait, st.canc)
  from st
  union all
  select 'Projected visitors vs goal',
         round(pr.projected_visitors / nullif(pr.visitors_goal, 0), 4), 'ratio', 1, 0.95,
         case when pr.projected_visitors >= pr.visitors_goal then 'good'
              when pr.projected_visitors >= 0.95 * pr.visitors_goal then 'watch' else 'alert' end,
         'All bets',
         format('Projected %s vs goal %s (%s).', round(pr.projected_visitors), pr.visitors_goal,
                case when pr.event_phase = 'pre-event' then 'run-rate x assumed show rate' else 'actual' end)
  from pr
  union all
  select 'Budget pace (spend share minus time share)', round(pace.spent_share - pace.time_share, 4), 'ratio', 0, 0.15,
         case when pace.spent_share - pace.time_share > 0.15 then 'alert'
              when pace.spent_share - pace.time_share > 0.05 then 'watch' else 'good' end,
         'Budget', format('%s%% of budget spent, %s%% of the campaign window gone.',
                          round(100 * pace.spent_share), round(100 * pace.time_share))
  from pace
$$;
