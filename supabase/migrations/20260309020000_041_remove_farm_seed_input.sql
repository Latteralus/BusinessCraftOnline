-- Phase 24: farms no longer consume seeds during extraction.
-- Remove the obsolete seed-efficiency upgrade from upgrade surfaces.

delete from public.business_upgrades
where upgrade_key = 'seed_efficiency';

delete from public.upgrade_definitions
where upgrade_key = 'seed_efficiency';

-- Migration complete: remove obsolete farm seed upgrade after seed input removal
