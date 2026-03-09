alter table public.store_shelf_items
  drop constraint if exists store_shelf_items_owner_player_id_fkey;

alter table public.store_shelf_items
  add constraint store_shelf_items_owner_player_id_fkey
  foreign key (owner_player_id)
  references public.players(id)
  on delete cascade;
