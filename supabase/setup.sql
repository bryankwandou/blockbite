-- Run this ONCE in Supabase SQL Editor: https://supabase.com/dashboard/project/engunjvhamcjgsbtynha/sql
-- Takes < 5 seconds.

CREATE TABLE IF NOT EXISTS waitlist (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist (created_at DESC);

-- Optional: import existing emails
-- INSERT INTO waitlist (email) VALUES ('example@email.com') ON CONFLICT DO NOTHING;
