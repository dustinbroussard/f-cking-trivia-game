-- 1. Create Public Profiles (Metadata for games)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  display_name text,
  photo_url text,
  stats jsonb default '{
    "wins": 0,
    "losses": 0,
    "completedGames": 0,
    "totalQuestionsSeen": 0,
    "totalQuestionsCorrect": 0,
    "categoryPerformance": {}
  }'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create Questions (AI-Generated Trivia Bank)
create table public.questions (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  correct_answer text not null,
  distractors jsonb not null, -- JSONB array of strings
  category text not null,
  difficulty_level text check (difficulty_level in ('easy', 'medium', 'hard')),
  validation_status text check (validation_status in ('pending', 'approved', 'rejected')) default 'pending',
  used_count integer default 0,
  explanation text,
  styling jsonb default '{}'::jsonb, -- presentation flags, styled question/explanation
  batch_id text,
  metadata jsonb default '{}'::jsonb, -- any extra fields from heritage
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Optimize for rapid retrieval during games
create index idx_questions_category_difficulty_vstatus on public.questions(category, difficulty_level, validation_status);
create index idx_questions_used_count on public.questions(used_count);
-- Index for text search (optimization)
create index idx_questions_content_trgm on public.questions using gin (content gin_trgm_ops);

-- 3. Create Games (Active and Completed Game Sessions)
create table public.games (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  status text check (status in ('waiting', 'active', 'completed', 'abandoned')) default 'waiting',
  host_id uuid references auth.users not null,
  current_turn uuid references auth.users,
  current_question_id uuid references public.questions,
  question_ids uuid[] default '{}'::uuid[], -- List of questions for the game
  winner_id uuid references auth.users,
  final_scores jsonb default '{}'::jsonb, -- map of user_id -> score
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Game Players (Many-to-Many relationship)
create table public.game_players (
  game_id uuid references public.games on delete cascade,
  user_id uuid references auth.users on delete cascade,
  score integer default 0,
  streak integer default 0,
  is_online boolean default true,
  primary key (game_id, user_id)
);

-- 5. Row Level Security (RLS) Policies
alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;

-- Profiles: Anyone can view, but only the owner can update
create policy "Public profiles are viewable by everyone."
  on public.profiles for select
  using ( true );

create policy "Users can update their own profile."
  on public.profiles for update
  using ( auth.uid() = id );

-- Questions: Authenticated users can read bank. Only admins (special role) or AI pipeline can insert/update.
-- For now, allow authenticated users to read.
create policy "Authenticated users can read questions."
  on public.questions for select
  to authenticated
  using ( true );

-- Games: Players can see games they are part of, or public lobbies.
-- Simplified policy: Auth users can create games and read any active games.
create policy "Users can view games."
  on public.games for select
  to authenticated
  using ( true );

create policy "Players can create games."
  on public.games for insert
  to authenticated
  with check ( auth.uid() = host_id );

create policy "Hosts can update their games."
  on public.games for update
  to authenticated
  using ( auth.uid() = host_id );

-- Game Players: Visible to everyone in the game
create policy "Game players are viewable by game participants."
  on public.game_players for select
  to authenticated
  using ( true );

create policy "Players can join games."
  on public.game_players for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- 5. Seen Questions (To avoid repetition)
create table public.seen_questions (
  user_id uuid references auth.users on delete cascade,
  question_id uuid references public.questions on delete cascade,
  seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, question_id)
);

alter table public.seen_questions enable row level security;

create policy "Users can view their own seen questions."
  on public.seen_questions for select
  using ( auth.uid() = user_id );

create policy "Users can mark questions as seen."
  on public.seen_questions for insert
  with check ( auth.uid() = user_id );

-- 6. Trigger: Automatic Profile Creation upon Signup
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, photo_url)
  values (new.id, new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'photo_url');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 7. RPC: Increment Used Count
create function public.increment_question_used_count(q_id uuid)
returns void as $$
begin
  update public.questions
  set used_count = used_count + 1
  where id = q_id;
end;
$$ language plpgsql security definer;
