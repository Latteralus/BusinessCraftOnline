alter table public.extraction_slots
  add column if not exists input_progress numeric(12,4) not null default 0;

comment on column public.extraction_slots.input_progress is
  'Carries fractional extraction input consumption across ticks for deterministic production.';

alter table public.manufacturing_jobs
  add column if not exists output_progress numeric(12,4) not null default 0,
  add column if not exists input_progress jsonb not null default '{}'::jsonb;

comment on column public.manufacturing_jobs.output_progress is
  'Carries fractional manufacturing output across ticks for deterministic production.';

comment on column public.manufacturing_jobs.input_progress is
  'Carries fractional manufacturing input consumption by item key across ticks for deterministic production.';
