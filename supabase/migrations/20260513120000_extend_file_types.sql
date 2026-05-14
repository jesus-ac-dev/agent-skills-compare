-- Extend file_types so the pipeline can label code/config files properly.
-- Today everything that isn't markdown falls into 'text' and that buries the
-- distinction between a 4 KB JS module and a 4 KB CSV dump.

INSERT INTO "public"."file_types" (name) VALUES
  ('javascript'),
  ('typescript'),
  ('python'),
  ('shell')
ON CONFLICT (name) DO NOTHING;
