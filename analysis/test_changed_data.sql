-- Changed-data robustness tests. Runs inside a transaction and rolls back.
--   psql "$DATABASE_URL" -f analysis/test_changed_data.sql
\set ON_ERROR_STOP on
begin;

create temp table t_results (test text, expected text, actual text, pass boolean);
create temp table t_base as select * from f_overview('2025-04-20');

-- T1: an exact import-retry duplicate of a check-in must not change anything
insert into src_checkins (event_id, person_id, person_name, registration_id, campaign_id, campaign_name,
                          owner_name, owner_id, occurred_at, result, verification, source)
select event_id, person_id, person_name, registration_id, campaign_id, campaign_name,
       owner_name, owner_id, occurred_at, result, verification, source
from v_checkins where result = 'admitted' and verification = 'verified' limit 1;
insert into t_results select 'T1 duplicate check-in ignored',
  (select unique_external_visitors from t_base)::text,
  (select unique_external_visitors from f_overview('2025-04-20'))::text, null;

-- T2: a NEW verified admission for an EXISTING visitor (day 2) keeps visitors unique
insert into src_checkins (event_id, person_id, occurred_at, result, verification, source)
select 'TEST-EV-2', person_id, '2025-04-13 12:00:00+05:30', 'admitted', 'verified', 'scanner'
from f_visitors_asof('2025-04-20') where person_type = 'external' limit 1;
insert into t_results select 'T2 repeat admission not a new visitor',
  (select unique_external_visitors from t_base)::text,
  (select unique_external_visitors from f_overview('2025-04-20'))::text, null;

-- T3: pending / unverified admission for a new external walk-in does NOT count
insert into src_people (person_id, person_name, person_type, first_seen_at, first_touch_source)
values ('TEST-P-1', 'Test Walkin', 'external', '2025-04-13 11:00:00+05:30', 'walk_in');
insert into src_checkins (event_id, person_id, occurred_at, result, verification, source)
values ('TEST-EV-3', 'TEST-P-1', '2025-04-13 11:00:00+05:30', 'pending', 'unverified', 'manual');
insert into t_results select 'T3 pending check-in not counted',
  (select unique_external_visitors from t_base)::text,
  (select unique_external_visitors from f_overview('2025-04-20'))::text, null;

-- T4: once that walk-in is admitted + verified, visitors and walk-ins go up by exactly 1
insert into src_checkins (event_id, person_id, occurred_at, result, verification, source)
values ('TEST-EV-4', 'TEST-P-1', '2025-04-13 11:05:00+05:30', 'admitted', 'verified', 'manual');
insert into t_results select 'T4 verified walk-in adds 1',
  ((select unique_external_visitors from t_base) + 1)::text || '/' || ((select walk_in_visitors from t_base) + 1)::text,
  (select unique_external_visitors::text || '/' || walk_in_visitors::text from f_overview('2025-04-20')), null;

-- T5: a staff/test person admitted+verified is excluded
insert into src_people (person_id, person_name, person_type, first_seen_at, first_touch_source)
values ('TEST-S-1', 'Test Staff', 'staff', '2025-04-12 09:00:00+05:30', 'event_access');
insert into src_checkins (event_id, person_id, occurred_at, result, verification, source)
values ('TEST-EV-5', 'TEST-S-1', '2025-04-12 09:05:00+05:30', 'admitted', 'verified', 'scanner');
insert into t_results select 'T5 staff excluded',
  ((select unique_external_visitors from t_base) + 1)::text,
  (select unique_external_visitors from f_overview('2025-04-20'))::text, null;

-- T6: a status change dated AFTER the snapshot must not leak into it
insert into src_registration_history (history_id, registration_id, person_id, effective_at, status)
select 'TEST-H-1', registration_id, person_id, '2025-04-25 10:00:00+05:30', 'cancelled'
from f_registrations_asof('2025-04-20') where status = 'confirmed' and person_type = 'external' limit 1;
insert into t_results select 'T6 future status does not leak',
  (select confirmed_external_people from t_base)::text,
  (select confirmed_external_people from f_overview('2025-04-20'))::text, null;
insert into t_results select 'T6b ...but applies after its date',
  ((select confirmed_external_people from t_base) - 1)::text,
  (select confirmed_external_people from f_overview('2025-04-26'))::text, null;

-- T7: a spend credit (negative) reduces spend; app-entered spend row is picked up
insert into src_campaign_daily (activity_id, campaign_id, activity_date, marketing_spend_inr, platform, origin)
values ('TEST-A-1', 'C02', '2025-04-19', -1000, 'marketing ledger adjustment', 'app');
insert into t_results select 'T7 credit reduces spend',
  ((select spend_inr from t_base) - 1000)::text,
  (select spend_inr from f_overview('2025-04-20'))::text, null;

-- T8: editing a target creates a new version that applies from its effective date only
insert into src_targets (effective_at, identified_external_people_goal, registration_goal,
                         unique_external_visitors_goal, marketing_budget_inr, target_version, origin)
values ('2025-04-01 09:00:00+05:30', 3600, 3200, 2500, 300000, 'Test April plan', 'app');
insert into t_results select 'T8 new target applies from date',
  '2200 -> 2500',
  (select visitors_goal from f_overview('2025-03-31'))::text || ' -> ' ||
  (select visitors_goal from f_overview('2025-04-02'))::text, null;

update t_results set pass = (expected = actual);
select * from t_results;
select case when bool_and(pass) then 'ALL CHANGED-DATA TESTS PASS' else 'FAILURES' end as summary from t_results;
rollback;
