-- TAC-9: the staff roles from packages/contracts GRANTABLE_ROLES. `user` is implicit and never stored.
INSERT INTO "Role" ("id", "description") VALUES
  ('owner', 'Everything, including AI prompts, policies and role grants'),
  ('content_editor', 'Drafts exercises, templates, foods and recipes'),
  ('content_reviewer', 'Reviews and publishes exercises and workout templates'),
  ('nutrition_reviewer', 'Reviews and publishes foods and recipes'),
  ('safety_reviewer', 'Works the safety review queue and user feedback'),
  ('support', 'Reads a masked support view of a user and their feedback')
ON CONFLICT ("id") DO UPDATE SET "description" = EXCLUDED."description";
