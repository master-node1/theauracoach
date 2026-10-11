#!/bin/sh
# Local only: one database and one login role per service (ERD §5). Passwords here are for the
# throwaway local stack; deployed environments get generated passwords from Secrets Manager.
set -eu
for svc in profile workout nutrition progress coach notification audit; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE ${svc}_svc LOGIN PASSWORD 'local-dev-only';
CREATE DATABASE ${svc}_db OWNER ${svc}_svc;
REVOKE ALL ON DATABASE ${svc}_db FROM PUBLIC;
SQL
done
