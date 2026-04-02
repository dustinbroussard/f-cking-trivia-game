alter table public.games
  add column if not exists updated_at timestamptz;

update public.games
set updated_at = coalesce(last_updated_at, created_at, now())
where updated_at is null;

alter table public.games
  alter column updated_at set default now();

alter table public.games
  alter column updated_at set not null;

create or replace function public.touch_games_updated_at()
returns trigger
language plpgsql
as $$
declare
  v_now timestamptz := now();
begin
  new.updated_at := v_now;

  if new.last_updated_at is null or new.last_updated_at is not distinct from old.last_updated_at then
    new.last_updated_at := v_now;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_games_timestamp_compat on public.games;
drop trigger if exists touch_games_updated_at on public.games;

create trigger touch_games_updated_at
before update on public.games
for each row
execute function public.touch_games_updated_at();
