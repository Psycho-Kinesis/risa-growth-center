-- =====================================================================
-- Clean views: one row per stable source ID.
-- Source rule: "Exact repeated IDs are import copies and count once."
-- If the same ID ever arrives with a different payload, the most
-- recently loaded row (_row desc) wins.
-- =====================================================================

create or replace view v_campaign_daily as
select distinct on (activity_id) *
from src_campaign_daily
order by activity_id, _row desc;

create or replace view v_people as
select distinct on (person_id) *
from src_people
order by person_id, _row desc;

create or replace view v_lead_interactions as
select distinct on (interaction_id) *
from src_lead_interactions
order by interaction_id, _row desc;

create or replace view v_registrations as
select distinct on (registration_id) *
from src_registrations
order by registration_id, _row desc;

create or replace view v_registration_history as
select distinct on (history_id) *
from src_registration_history
order by history_id, _row desc;

create or replace view v_checkins as
select distinct on (event_id) *
from src_checkins
order by event_id, _row desc;

-- Team dictionary derived from the source (owner_id -> owner_name).
create or replace view v_owners as
select distinct owner_id, owner_name
from (
  select owner_id, owner_name from src_campaigns
  union select owner_id, owner_name from v_campaign_daily
  union select owner_id, owner_name from v_people
) t
where owner_id is not null;

-- Data-quality summary: how many raw rows were import copies.
create or replace view v_data_quality as
select 'campaign_daily' as source_table, count(*) as raw_rows, count(distinct activity_id) as unique_ids from src_campaign_daily
union all select 'people', count(*), count(distinct person_id) from src_people
union all select 'lead_interactions', count(*), count(distinct interaction_id) from src_lead_interactions
union all select 'registrations', count(*), count(distinct registration_id) from src_registrations
union all select 'registration_history', count(*), count(distinct history_id) from src_registration_history
union all select 'checkins', count(*), count(distinct event_id) from src_checkins;
