alter table public.extraction_slots
  add column if not exists output_progress numeric(12,4) not null default 0;

comment on column public.extraction_slots.output_progress is
  'Carries fractional extraction output across ticks so reduced-rate production remains deterministic.';
