-- =====================================================================
-- CampusFest Growth Center — schema
-- Challenge A: Attendee Growth
--
-- Design rules
--   * src_* tables hold the ORIGINAL source rows exactly as supplied,
--     including import-retry duplicates. Nothing is deleted on load.
--   * Every source table has a surrogate _row key so duplicates survive;
--     clean views (02_views.sql) deduplicate on the stable source ID.
--   * Rows added through the app go into the same tables with
--     origin = 'app', so analytics pick them up immediately.
--   * All timestamps are timestamptz. Source values are IST (+05:30).
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+ (no extension needed).

-- ---------- reference ------------------------------------------------
create table if not exists src_event (
  event_name        text primary key,
  history_start     date not null,
  history_end       date not null,
  event_starts_at   timestamptz not null,
  event_ends_at     timestamptz not null,
  timezone          text not null default 'Asia/Kolkata',
  currency          text not null default 'INR',
  fictional         boolean not null default true
);

create table if not exists src_targets (
  _row                              bigserial primary key,
  effective_at                      timestamptz not null,
  identified_external_people_goal   integer not null,
  registration_goal                 integer not null,
  unique_external_visitors_goal     integer not null,
  marketing_budget_inr              bigint  not null,
  target_version                    text not null,
  origin                            text not null default 'source'
);

-- Campaigns: source columns + editable management fields.
create table if not exists src_campaigns (
  campaign_id        text primary key,
  campaign_name      text not null,
  channel            text not null,
  target_audience    text,
  objective          text,
  owner_name         text,
  owner_id           text,
  created_at         timestamptz,
  planned_start_at   timestamptz,
  planned_end_at     timestamptz,
  -- management fields (not in source; editable in the app)
  status             text not null default 'active'
                     check (status in ('planned','active','paused','stopped','completed')),
  planned_budget_inr bigint,            -- per-campaign allocation; null = not allocated
  notes              text,
  origin             text not null default 'source',
  updated_at         timestamptz not null default now()
);

-- ---------- awareness (anonymous daily aggregates) --------------------
create table if not exists src_campaign_daily (
  _row                   bigserial primary key,
  activity_id            text not null,
  campaign_id            text not null,
  campaign_name          text,
  owner_name             text,
  owner_id               text,
  activity_date          date not null,
  impressions            bigint  not null default 0,
  clicks                 bigint  not null default 0,
  reported_reach         bigint  not null default 0,
  landing_page_sessions  bigint  not null default 0,
  registration_starts    bigint  not null default 0,
  marketing_spend_inr    bigint  not null default 0,   -- may be negative (vendor credit)
  platform               text,
  origin                 text not null default 'source'
);
create index if not exists ix_daily_id   on src_campaign_daily(activity_id);
create index if not exists ix_daily_date on src_campaign_daily(activity_date);

-- ---------- identified people & actions ------------------------------
create table if not exists src_people (
  _row                 bigserial primary key,
  person_id            text not null,
  person_name          text,
  person_type          text not null,   -- external | internal | staff | test
  first_seen_at        timestamptz not null,
  first_touch_source   text,            -- campaign | internal_registration | walk_in | event_access
  first_campaign_id    text,
  first_campaign_name  text,
  owner_name           text,
  owner_id             text,
  origin               text not null default 'source'
);
create index if not exists ix_people_id on src_people(person_id);

create table if not exists src_lead_interactions (
  _row            bigserial primary key,
  interaction_id  text not null,
  person_id       text not null,
  person_name     text,
  campaign_id     text,
  campaign_name   text,
  owner_name      text,
  owner_id        text,
  occurred_at     timestamptz not null,
  event_type      text not null,
  detail          text,
  origin          text not null default 'source'
);
create index if not exists ix_li_id   on src_lead_interactions(interaction_id);
create index if not exists ix_li_time on src_lead_interactions(occurred_at);

create table if not exists src_registrations (
  _row             bigserial primary key,
  registration_id  text not null,
  person_id        text not null,
  person_name      text,
  campaign_id      text,
  campaign_name    text,
  owner_name       text,
  owner_id         text,
  registered_at    timestamptz not null,
  origin           text not null default 'source'
);
create index if not exists ix_reg_id on src_registrations(registration_id);

create table if not exists src_registration_history (
  _row             bigserial primary key,
  history_id       text not null,
  registration_id  text not null,
  person_id        text,
  person_name      text,
  campaign_id      text,
  campaign_name    text,
  owner_name       text,
  owner_id         text,
  effective_at     timestamptz not null,
  status           text not null,   -- interested | confirmed | cancelled | waitlisted
  origin           text not null default 'source'
);
create index if not exists ix_rh_id  on src_registration_history(history_id);
create index if not exists ix_rh_reg on src_registration_history(registration_id, effective_at);

create table if not exists src_checkins (
  _row             bigserial primary key,
  event_id         text not null,
  person_id        text not null,
  person_name      text,
  registration_id  text,
  campaign_id      text,
  campaign_name    text,
  owner_name       text,
  owner_id         text,
  occurred_at      timestamptz not null,
  result           text not null,   -- admitted | denied | pending
  verification     text not null,   -- verified | unverified
  source           text,            -- scanner | manual
  origin           text not null default 'source'
);
create index if not exists ix_ci_id on src_checkins(event_id);

-- ---------- management (app-owned) -----------------------------------
create table if not exists app_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  campaign_id   text references src_campaigns(campaign_id),
  owner_name    text,
  due_date      date,
  status        text not null default 'todo'
                check (status in ('todo','in_progress','blocked','done')),
  priority      text not null default 'medium'
                check (priority in ('low','medium','high')),
  created_by    text not null default 'user',     -- user | ai_copilot
  evidence      text,                             -- why this task exists (data reference)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Model assumptions the dashboard/projections use. Kept in the DB so they
-- are visible, editable and clearly separated from sourced facts.
create table if not exists app_assumptions (
  key          text primary key,
  value        numeric not null,
  unit         text,
  description  text not null,
  basis        text not null,   -- 'sourced' | 'derived from dataset' | 'assumption'
  updated_at   timestamptz not null default now()
);

-- Actions the AI copilot proposes. Nothing changes until a person confirms.
create table if not exists app_pending_actions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('create_task','update_campaign')),
  payload      jsonb not null,
  summary      text not null,
  status       text not null default 'pending'
               check (status in ('pending','confirmed','cancelled','failed')),
  result       jsonb,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);

-- Audit trail of every change made through the app or the copilot.
create table if not exists app_activity_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,          -- user | ai_copilot
  entity     text not null,          -- task | campaign | daily_marketing | target | assumption
  entity_id  text,
  action     text not null,          -- create | update | delete
  details    jsonb
);
