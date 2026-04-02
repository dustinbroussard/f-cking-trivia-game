create extension if not exists pgcrypto;

create type public.difficulty_level as enum ('easy', 'medium', 'hard');
create type public.game_status as enum ('waiting', 'active', 'completed', 'abandoned');
create type public.invite_status as enum ('pending', 'accepted', 'declined', 'expired');
create type public.question_validation_status as enum ('pending', 'verified', 'approved', 'rejected', 'flagged');
create type public.question_verdict as enum ('pass', 'reject');
create type public.answer_source as enum ('answer', 'timeout');

create or replace function public.normalize_question_text(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '\s+', ' ', 'g');
$$;

create or replace function public.get_session_questions(
  p_categories text[],
  p_count_per_category integer,
  p_exclude_question_ids uuid[] default '{}'::uuid[],
  p_user_ids uuid[] default '{}'::uuid[]
)
returns setof public.questions
language sql
volatile
as $$
  with requested_categories as (
    select distinct unnest(coalesce(p_categories, '{}'::text[])) as category
  ),
  seen_questions as (
    select distinct usq.question_id
    from public.user_seen_questions usq
    where usq.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
  ),
  eligible_questions as (
    select
      q.*,
      (random() / greatest(q.used_count + 1, 1)::double precision) as fairness_score
    from public.questions q
    join requested_categories rc on rc.category = q.category
    left join seen_questions sq on sq.question_id = q.id
    where q.validation_status = 'approved'
      and not (q.id = any(coalesce(p_exclude_question_ids, '{}'::uuid[])))
      and sq.question_id is null
  ),
  deduped_questions as (
    select distinct on (eq.question_hash)
      eq.*
    from eligible_questions eq
    order by eq.question_hash, eq.fairness_score desc, eq.used_count asc, eq.created_at asc, random()
  ),
  ranked_questions as (
    select
      dq.id,
      row_number() over (
        partition by dq.category
        order by dq.fairness_score desc, random()
      ) as selection_rank
    from deduped_questions dq
  )
  select q.*
  from ranked_questions rq
  join public.questions q on q.id = rq.id
  where rq.selection_rank <= greatest(p_count_per_category, 0);
$$;

create or replace function public.increment_question_used_count(q_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.questions
  set used_count = used_count + 1
  where id = q_id;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  firebase_uid text unique,
  display_name text not null default 'Player',
  photo_url text,
  completed_games integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  total_questions_seen integer not null default 0,
  total_questions_correct integer not null default 0,
  category_performance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint profiles_category_performance_object check (jsonb_typeof(category_performance) = 'object')
);

create table if not exists public.user_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  theme_mode text not null default 'dark' check (theme_mode in ('dark', 'light')),
  sound_enabled boolean not null default true,
  music_enabled boolean not null default true,
  sfx_enabled boolean not null default true,
  commentary_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_identity_migrations (
  firebase_uid text primary key,
  profile_id uuid unique references public.profiles (id) on delete cascade,
  email text,
  provider text,
  firebase_custom_claims jsonb not null default '{}'::jsonb,
  requires_password_reset boolean not null default false,
  migrated_at timestamptz,
  notes text
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  content text not null,
  correct_answer text not null,
  distractors jsonb not null,
  category text not null,
  difficulty_level public.difficulty_level not null,
  explanation text not null,
  question_styled text,
  explanation_styled text,
  host_lead_in text,
  validation_status public.question_validation_status not null default 'pending',
  verification_verdict public.question_verdict,
  verification_confidence text check (verification_confidence in ('high', 'medium', 'low')),
  verification_issues jsonb not null default '[]'::jsonb,
  verification_reason text,
  pipeline_version text,
  source text,
  batch_id text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  question_hash text generated always as (
    encode(digest(public.normalize_question_text(content), 'sha256'), 'hex')
  ) stored,
  constraint questions_distractors_array check (
    jsonb_typeof(distractors) = 'array' and jsonb_array_length(distractors) = 3
  ),
  constraint questions_verification_issues_array check (
    jsonb_typeof(verification_issues) = 'array'
  )
);

create unique index if not exists questions_question_hash_key on public.questions (question_hash);
create index if not exists questions_category_difficulty_status_idx
  on public.questions (category, difficulty_level, validation_status, used_count, created_at);
create index if not exists questions_created_by_profile_idx on public.questions (created_by_profile_id);

create table if not exists public.question_flags (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  reporter_profile_id uuid not null references public.profiles (id) on delete cascade,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  join_code text not null,
  status public.game_status not null default 'waiting',
  host_profile_id uuid not null references public.profiles (id) on delete restrict,
  current_turn_profile_id uuid references public.profiles (id) on delete set null,
  winner_profile_id uuid references public.profiles (id) on delete set null,
  current_question_category text,
  current_question_index integer,
  current_question_started_at timestamptz,
  completed_at timestamptz,
  categories_used jsonb not null default '[]'::jsonb,
  final_scores jsonb not null default '{}'::jsonb,
  stats_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  constraint games_join_code_len check (char_length(join_code) between 4 and 12),
  constraint games_categories_used_array check (jsonb_typeof(categories_used) = 'array'),
  constraint games_final_scores_object check (jsonb_typeof(final_scores) = 'object')
);

create unique index if not exists games_join_code_waiting_idx
  on public.games (join_code)
  where status = 'waiting';
create index if not exists games_host_status_idx on public.games (host_profile_id, status, created_at desc);
create index if not exists games_current_turn_idx on public.games (current_turn_profile_id, status);

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

drop trigger if exists touch_games_updated_at on public.games;

create trigger touch_games_updated_at
before update on public.games
for each row
execute function public.touch_games_updated_at();

create table if not exists public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  display_name_snapshot text not null,
  avatar_url_snapshot text,
  score integer not null default 0,
  streak integer not null default 0,
  completed_categories jsonb not null default '[]'::jsonb,
  last_active_at timestamptz,
  last_resumed_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (game_id, profile_id),
  constraint game_players_completed_categories_array check (jsonb_typeof(completed_categories) = 'array')
);

create index if not exists game_players_profile_idx on public.game_players (profile_id, joined_at desc);

create table if not exists public.game_questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  question_id uuid references public.questions (id) on delete set null,
  legacy_firestore_id text,
  ordinal integer not null,
  category text not null,
  difficulty_level public.difficulty_level not null,
  content text not null,
  choices jsonb not null,
  correct_index integer not null check (correct_index between 0 and 3),
  explanation text not null,
  question_styled text,
  explanation_styled text,
  host_lead_in text,
  used boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, ordinal),
  constraint game_questions_choices_array check (
    jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) = 4
  )
);

alter table public.games
  add column if not exists current_game_question_id uuid references public.game_questions (id) on delete set null;

create index if not exists game_questions_game_used_idx on public.game_questions (game_id, used, ordinal);
create index if not exists game_questions_question_id_idx on public.game_questions (question_id);

create table if not exists public.game_answers (
  game_question_id uuid not null references public.game_questions (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  answer_index integer not null,
  submitted_at timestamptz not null default now(),
  is_correct boolean not null,
  source public.answer_source not null default 'answer',
  primary key (game_question_id, profile_id)
);

create index if not exists game_answers_profile_idx on public.game_answers (profile_id, submitted_at desc);

create table if not exists public.game_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  display_name_snapshot text not null,
  avatar_url_snapshot text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists game_messages_game_created_idx on public.game_messages (game_id, created_at desc);

create table if not exists public.game_invites (
  id uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references public.profiles (id) on delete cascade,
  to_profile_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  status public.invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (to_profile_id, game_id, status)
);

create index if not exists game_invites_to_status_idx on public.game_invites (to_profile_id, status, created_at desc);

create table if not exists public.user_seen_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, question_id)
);

create table if not exists public.recent_player_edges (
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  opponent_profile_id uuid not null references public.profiles (id) on delete cascade,
  last_played_at timestamptz not null,
  last_game_id uuid references public.games (id) on delete set null,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_profile_id, opponent_profile_id)
);

create index if not exists recent_player_edges_owner_played_idx
  on public.recent_player_edges (owner_profile_id, last_played_at desc);

create or replace view public.profile_recent_completed_games as
select
  gp.profile_id,
  g.id as game_id,
  g.completed_at,
  g.winner_profile_id,
  g.final_scores,
  g.categories_used,
  g.status
from public.game_players gp
join public.games g on g.id = gp.game_id
where g.status = 'completed';

create or replace view public.profile_matchup_summaries as
select
  gp.profile_id,
  opponent.profile_id as opponent_profile_id,
  count(*)::integer as total_games,
  count(*) filter (where g.winner_profile_id = gp.profile_id)::integer as wins,
  count(*) filter (where g.winner_profile_id = opponent.profile_id)::integer as losses,
  max(g.completed_at) as last_played_at
from public.game_players gp
join public.game_players opponent
  on opponent.game_id = gp.game_id
 and opponent.profile_id <> gp.profile_id
join public.games g on g.id = gp.game_id
where g.status = 'completed'
group by gp.profile_id, opponent.profile_id;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.questions enable row level security;
alter table public.question_flags enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_answers enable row level security;
alter table public.game_messages enable row level security;
alter table public.game_invites enable row level security;
alter table public.user_seen_questions enable row level security;
alter table public.recent_player_edges enable row level security;

create policy "profiles_select_own_or_public_name"
  on public.profiles
  for select
  using (true);

create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "user_settings_own_all"
  on public.user_settings
  for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "questions_authenticated_read"
  on public.questions
  for select
  using (auth.role() = 'authenticated');

create policy "questions_service_write"
  on public.questions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "question_flags_authenticated_insert"
  on public.question_flags
  for insert
  with check (auth.uid() = reporter_profile_id);

create policy "question_flags_own_select"
  on public.question_flags
  for select
  using (auth.uid() = reporter_profile_id or auth.role() = 'service_role');

create policy "games_participant_read"
  on public.games
  for select
  using (
    exists (
      select 1
      from public.game_players gp
      where gp.game_id = games.id
        and gp.profile_id = auth.uid()
    )
  );

create policy "games_host_insert"
  on public.games
  for insert
  with check (auth.uid() = host_profile_id);

create policy "games_participant_update"
  on public.games
  for update
  using (
    exists (
      select 1
      from public.game_players gp
      where gp.game_id = games.id
        and gp.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.game_players gp
      where gp.game_id = games.id
        and gp.profile_id = auth.uid()
    )
  );

create policy "game_players_participant_read"
  on public.game_players
  for select
  using (
    exists (
      select 1
      from public.game_players gp
      where gp.game_id = game_players.game_id
        and gp.profile_id = auth.uid()
    )
  );

create policy "game_players_self_write"
  on public.game_players
  for all
  using (
    auth.uid() = profile_id
    or auth.role() = 'service_role'
  )
  with check (
    auth.uid() = profile_id
    or auth.role() = 'service_role'
  );

create policy "game_questions_participant_read"
  on public.game_questions
  for select
  using (
    exists (
      select 1
      from public.game_players gp
      where gp.game_id = game_questions.game_id
        and gp.profile_id = auth.uid()
    )
  );

create policy "game_questions_service_write"
  on public.game_questions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "game_answers_participant_read"
  on public.game_answers
  for select
  using (
    auth.uid() = profile_id
    or exists (
      select 1
      from public.game_questions gq
      join public.game_players gp on gp.game_id = gq.game_id
      where gq.id = game_answers.game_question_id
        and gp.profile_id = auth.uid()
    )
  );

create policy "game_answers_self_insert"
  on public.game_answers
  for insert
  with check (auth.uid() = profile_id);

create policy "game_messages_participant_read"
  on public.game_messages
  for select
  using (
    exists (
      select 1
      from public.game_players gp
      where gp.game_id = game_messages.game_id
        and gp.profile_id = auth.uid()
    )
  );

create policy "game_messages_participant_insert"
  on public.game_messages
  for insert
  with check (
    auth.uid() = profile_id
    and exists (
      select 1
      from public.game_players gp
      where gp.game_id = game_messages.game_id
        and gp.profile_id = auth.uid()
    )
  );

create policy "game_invites_inbox_read"
  on public.game_invites
  for select
  using (auth.uid() in (from_profile_id, to_profile_id));

create policy "game_invites_sender_insert"
  on public.game_invites
  for insert
  with check (auth.uid() = from_profile_id);

create policy "game_invites_recipient_update"
  on public.game_invites
  for update
  using (auth.uid() = to_profile_id or auth.uid() = from_profile_id)
  with check (auth.uid() = to_profile_id or auth.uid() = from_profile_id);

create policy "user_seen_questions_own_all"
  on public.user_seen_questions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recent_player_edges_own_all"
  on public.recent_player_edges
  for all
  using (auth.uid() = owner_profile_id)
  with check (auth.uid() = owner_profile_id);

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.game_questions;
alter publication supabase_realtime add table public.game_answers;
alter publication supabase_realtime add table public.game_messages;
alter publication supabase_realtime add table public.game_invites;
