-- Add 'prompt' as a first-class file_type so .txt agent prompts (OpenCode,
-- Codex, etc.) no longer fall into the generic 'text' bucket and get the
-- wrong kind=text classifier prompt.

INSERT INTO "public"."file_types" (name) VALUES
  ('prompt')
ON CONFLICT (name) DO NOTHING;
