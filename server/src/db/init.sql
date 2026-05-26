CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  password_hash TEXT,
  display_name VARCHAR(16) NOT NULL,
  equipped_skin_id TEXT NOT NULL DEFAULT 'emoji_grin',
  -- JSONB: удобно мержить при гостевом→полному аккаунту. Для запросов «у кого есть скин X»
  -- можно позже мигрировать на text[] + GIN (owned_skin_ids @> ARRAY['skin_id']).
  owned_skin_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_guest_chk CHECK (
    (is_guest = true AND email IS NULL AND password_hash IS NULL)
    OR (is_guest = false AND email IS NOT NULL AND password_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_stats (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  games_played INT NOT NULL DEFAULT 0,
  kills INT NOT NULL DEFAULT 0,
  deaths INT NOT NULL DEFAULT 0,
  best_score INT NOT NULL DEFAULT 0,
  total_time_sec INT NOT NULL DEFAULT 0,
  coins INT NOT NULL DEFAULT 500,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friendships (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT friendships_no_self CHECK (user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS friendships_friend_idx ON friendships (friend_id);
