-- Model assumptions used by projections and signals. Editable in the app.
-- basis: 'assumption' = our judgement; 'derived from dataset' = computed from
-- the supplied CampusFest 2025 records; 'sourced' = external public source.
insert into app_assumptions (key, value, unit, description, basis) values
  ('expected_show_rate',        0.65, 'ratio',
   'Share of registered external people expected to attend (verified). Used only before the event.',
   'assumption — conservative vs CampusFest 2025 realized 0.6875 (derived from dataset)'),
  ('expected_walk_ins',         100,  'people',
   'Verified external visitors expected without any registration. Used only before the event.',
   'assumption — CampusFest 2025 realized 125 walk-ins (derived from dataset)'),
  ('runrate_window_days',       14,   'days',
   'Trailing window for registration and spend run-rates in projections.', 'assumption'),
  ('signal_scale_index',        0.80, 'x blended',
   'Scale a campaign when its cost per outcome is at or below this multiple of blended.', 'assumption'),
  ('signal_stop_index',         1.75, 'x blended',
   'Stop a campaign when its cost per outcome is at or above this multiple of blended.', 'assumption'),
  ('signal_min_registrations',  30,   'registrations',
   'Minimum registrations before a campaign signal is trusted.', 'assumption'),
  ('signal_cancel_rate_ratio',  1.5,  'x blended',
   'Flag (fix) when cancellation rate exceeds this multiple of blended.', 'assumption'),
  ('signal_max_opt_out_rate',   0.10, 'ratio',
   'Flag (fix) when opted-out people exceed this share of engaged people.', 'assumption')
on conflict (key) do nothing;

insert into app_assumptions (key, value, unit, description, basis) values
  ('target_engaged_share',  0.75, 'ratio', 'Target share of registrants who download the brochure, ask a question or click an email (S3).', 'assumption — 2025 was 0.59'),
  ('alert_engaged_share',   0.60, 'ratio', 'Alert when the engaged share of registrants falls below this.', 'assumption'),
  ('target_referral_share', 0.20, 'ratio', 'Target share of new registrations coming through referrals (S1).', 'assumption — 2025 was 0.125'),
  ('alert_referral_share',  0.12, 'ratio', 'Alert when the referral share of new registrations falls below this.', 'assumption'),
  ('max_cancel_rate',       0.08, 'ratio', 'Guardrail: alert when cancellations exceed this share of registrants.', 'assumption — 2025 was 0.065')
on conflict (key) do nothing;
