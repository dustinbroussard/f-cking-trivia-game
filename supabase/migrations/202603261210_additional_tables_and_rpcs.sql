-- 0. Add missing columns to initial games table if they don't exist
-- (Denormalized players array for compatibility with legacy game objects)
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS players jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS last_updated timestamp with time zone DEFAULT timezone('utc'::text, now());
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS current_question_category text;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS current_question_index integer;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS current_question_started_at timestamp with time zone;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS categories_used text[] DEFAULT '{}'::text[];
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS stats_recorded_at timestamp with time zone;

-- 1. Create Game Messages Table
CREATE TABLE public.game_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid REFERENCES public.games(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  timestamp timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create User Settings Table
CREATE TABLE public.user_settings (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  theme_mode text DEFAULT 'dark',
  sound_enabled boolean DEFAULT true,
  music_enabled boolean DEFAULT true,
  sfx_enabled boolean DEFAULT true,
  commentary_enabled boolean DEFAULT true,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create Recent Players Table
CREATE TABLE public.recent_players (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  photo_url text,
  last_played_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_game_id uuid REFERENCES public.games(id) ON DELETE SET NULL,
  hidden boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (user_id, opponent_id)
);

-- 4. Create Matchup History Table
CREATE TABLE public.matchup_history (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  wins integer DEFAULT 0,
  losses integer DEFAULT 0,
  last_played_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  opponent_display_name text,
  opponent_photo_url text,
  PRIMARY KEY (user_id, opponent_id)
);

-- 5. Create Completed Games Table (Archive)
CREATE TABLE public.completed_games (
  id uuid PRIMARY KEY,
  players jsonb DEFAULT '[]'::jsonb,
  winner_id uuid,
  final_scores jsonb DEFAULT '{}'::jsonb,
  categories_used text[] DEFAULT '{}'::text[],
  questions jsonb DEFAULT '[]'::jsonb,
  completed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. RPC: Record Game Answer
CREATE OR REPLACE FUNCTION public.record_game_answer(
  p_game_id uuid,
  p_question_id uuid,
  p_user_id uuid,
  p_answer jsonb
)
RETURNS void AS $$
BEGIN
  UPDATE public.games
  SET 
    answers = jsonb_set(
      COALESCE(answers, '{}'::jsonb),
      array[p_question_id::text, p_user_id::text],
      p_answer,
      true
    ),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC: Upsert Matchup History
CREATE OR REPLACE FUNCTION public.upsert_matchup_history(
  p_user_id uuid,
  p_opponent_id uuid,
  p_won integer,
  p_lost integer,
  p_opponent_display_name text,
  p_opponent_photo_url text
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.matchup_history (
    user_id, 
    opponent_id, 
    wins, 
    losses, 
    last_played_at, 
    opponent_display_name, 
    opponent_photo_url
  )
  VALUES (
    p_user_id, 
    p_opponent_id, 
    p_won, 
    p_lost, 
    timezone('utc'::text, now()), 
    p_opponent_display_name, 
    p_opponent_photo_url
  )
  ON CONFLICT (user_id, opponent_id) 
  DO UPDATE SET 
    wins = public.matchup_history.wins + p_won,
    losses = public.matchup_history.losses + p_lost,
    last_played_at = timezone('utc'::text, now()),
    opponent_display_name = p_opponent_display_name,
    opponent_photo_url = p_opponent_photo_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Enable Realtime (Optional if not done via dashboard)
ALTER TABLE public.game_messages REPLICA IDENTITY FULL;
ALTER TABLE public.games REPLICA IDENTITY FULL;
ALTER TABLE public.game_players REPLICA IDENTITY FULL;

-- 9. Generic Array Helpers
CREATE OR REPLACE FUNCTION public.array_append(
  table_name text,
  row_id uuid,
  field_name text,
  new_element text
) RETURNS void AS $$
BEGIN
  EXECUTE format('UPDATE %I SET %I = array_append(COALESCE(%I, ''{}''), $1) WHERE id = $2', 
    table_name, field_name, field_name)
    USING new_element, row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.array_remove(
  table_name text,
  row_id uuid,
  field_name text,
  old_element text
) RETURNS void AS $$
BEGIN
  EXECUTE format('UPDATE %I SET %I = array_remove(COALESCE(%I, ''{}''), $1) WHERE id = $2', 
    table_name, field_name, field_name)
    USING old_element, row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.increment_field(
  table_name text,
  row_id uuid,
  field_name text,
  increment_by integer DEFAULT 1
) RETURNS void AS $$
BEGIN
  EXECUTE format('UPDATE %I SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', 
    table_name, field_name, field_name)
    USING increment_by, row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. RLS Policies for New Tables
ALTER TABLE public.game_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recent_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completed_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Game messages viewable by everyone in game" ON public.game_messages FOR SELECT USING (true);
CREATE POLICY "Users can insert their own messages" ON public.game_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own recent players" ON public.recent_players FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own recent players" ON public.recent_players FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own matchup history" ON public.matchup_history FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Common access to completed games" ON public.completed_games FOR SELECT USING (true);
