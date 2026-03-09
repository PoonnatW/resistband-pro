-- ============================================================
--  ResistBand Pro — New Supabase Tables for Device Integration
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Command queue (phone → ESP32)
CREATE TABLE IF NOT EXISTS device_commands (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT        NOT NULL,
  params      JSONB       DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  consumed    BOOLEAN     DEFAULT FALSE
);

-- Allow anon reads/writes (commands are not sensitive — just motor length values)
ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON device_commands FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

-- 2. Device heartbeat / status
CREATE TABLE IF NOT EXISTS device_status (
  id           INT         PRIMARY KEY DEFAULT 1,
  status       TEXT        DEFAULT 'offline',
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the single status row
INSERT INTO device_status (id, status)
VALUES (1, 'offline')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE device_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON device_status FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

-- 3. Rep event queue (ESP32 → phone, transient)
CREATE TABLE IF NOT EXISTS device_rep_queue (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  quality     TEXT        NOT NULL,
  duration_ms FLOAT,
  force_data  JSONB       DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  consumed    BOOLEAN     DEFAULT FALSE
);

ALTER TABLE device_rep_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON device_rep_queue FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- Optional: auto-delete consumed rows older than 1 hour to keep table small
-- (Can enable once pg_cron is available on your Supabase plan)
-- SELECT cron.schedule('cleanup-rep-queue', '*/30 * * * *',
--   $$DELETE FROM device_rep_queue WHERE consumed = true AND created_at < NOW() - INTERVAL '1 hour'$$);
