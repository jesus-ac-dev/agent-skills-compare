-- supabase/migrations/20260512100000_create_settings_table.sql

CREATE TABLE IF NOT EXISTS "public"."settings" (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS settings_set_updated_at ON "public"."settings";
CREATE TRIGGER settings_set_updated_at
  BEFORE UPDATE ON "public"."settings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY settings_read_anon ON "public"."settings"
  FOR SELECT USING (true);
-- No write policy: anon cannot write; service_role bypasses RLS.

INSERT INTO "public"."settings" (key, value) VALUES ('llm_provider', 'groq')
ON CONFLICT (key) DO NOTHING;
