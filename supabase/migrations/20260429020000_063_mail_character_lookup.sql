create or replace function public.get_mail_character_names(
  p_player_ids uuid[]
)
returns table (
  player_id uuid,
  character_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.player_id,
    trim(c.first_name || ' ' || c.last_name) as character_name
  from public.characters c
  where auth.uid() is not null
    and c.player_id = any(coalesce(p_player_ids, array[]::uuid[]));
$$;

create or replace function public.search_mail_recipients(
  p_query text,
  p_exclude_player_id uuid default null
)
returns table (
  player_id uuid,
  character_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select trim(coalesce(p_query, '')) as q
  )
  select
    c.player_id,
    trim(c.first_name || ' ' || c.last_name) as character_name
  from public.characters c
  cross join normalized n
  where auth.uid() is not null
    and char_length(n.q) between 1 and 64
    and c.player_id <> coalesce(p_exclude_player_id, auth.uid())
    and (
      c.first_name ilike '%' || n.q || '%'
      or c.last_name ilike '%' || n.q || '%'
      or trim(c.first_name || ' ' || c.last_name) ilike '%' || n.q || '%'
    )
  order by
    case
      when trim(c.first_name || ' ' || c.last_name) ilike n.q || '%' then 0
      when c.first_name ilike n.q || '%' then 1
      when c.last_name ilike n.q || '%' then 2
      else 3
    end,
    c.first_name asc,
    c.last_name asc
  limit 10;
$$;

grant execute on function public.get_mail_character_names(uuid[]) to authenticated;
grant execute on function public.search_mail_recipients(text, uuid) to authenticated;
