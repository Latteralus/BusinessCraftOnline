-- Resolves audit finding M2 (Documents/SBAudit.md): getUnreadMailCount
-- (src/domains/mail/service.ts) pulled every unread thread's participant
-- row, then every message body in those threads, into the app process just
-- to derive one integer. Move the comparison into a SQL aggregate --
-- idx_mail_messages_thread_created_at (migration 060) already supports the
-- per-thread "is there a message newer than last_read_message_created_at"
-- existence check this does.

create or replace function public.get_unread_mail_count(p_player_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.mail_thread_participants p
  where p.player_id = p_player_id
    and p.deleted_at is null
    and exists (
      select 1
      from public.mail_messages m
      where m.thread_id = p.thread_id
        and (p.last_read_message_created_at is null or m.created_at > p.last_read_message_created_at)
    );
$$;

grant execute on function public.get_unread_mail_count(uuid) to authenticated;
