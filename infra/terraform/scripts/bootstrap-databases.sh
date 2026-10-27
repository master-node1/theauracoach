#!/usr/bin/env bash
# Creates one database and one login role per service on the prod RDS instance
# (ERD §5, same names as infra/local/postgres-init.sh) and writes each
# service's DATABASE_URL into its Secrets Manager entry auracoach/<env>/<service>.
#
# Run by the owner after `terraform apply` of envs/prod, from a machine with
# psql, jq and the AWS CLI, through an SSM port forward via the k3s node:
#
#   aws ssm start-session --target <k3s_instance_id> \
#     --document-name AWS-StartPortForwardingSessionToRemoteHost \
#     --parameters host=<rds_endpoint>,portNumber=5432,localPortNumber=15432
#
#   RDS_ENDPOINT=<rds_endpoint> MASTER_SECRET_ARN=<rds_master_secret_arn> \
#     ./bootstrap-databases.sh prod
#
# Idempotent: existing roles and databases are kept. A service whose secret
# already holds DATABASE_URL is skipped unless ROTATE=1, which sets a new password.
set -euo pipefail

ENVIRONMENT="${1:?usage: bootstrap-databases.sh <environment>}"
: "${RDS_ENDPOINT:?set RDS_ENDPOINT (terraform output rds_endpoint)}"
: "${MASTER_SECRET_ARN:?set MASTER_SECRET_ARN (terraform output rds_master_secret_arn)}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
ROTATE="${ROTATE:-0}"
SERVICES=(profile workout nutrition progress coach notification audit)

master_json=$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" --query SecretString --output text)
export PGUSER=$(jq -r .username <<<"$master_json")
export PGPASSWORD=$(jq -r .password <<<"$master_json")
export PGHOST=127.0.0.1 PGPORT="$LOCAL_PORT" PGDATABASE=postgres PGSSLMODE=require

for svc in "${SERVICES[@]}"; do
  secret_id="auracoach/${ENVIRONMENT}/${svc}-service"
  current=$(aws secretsmanager get-secret-value --secret-id "$secret_id" --query SecretString --output text 2>/dev/null || echo '{}')
  if [[ "$ROTATE" != 1 ]] && jq -e '.DATABASE_URL' <<<"$current" >/dev/null 2>&1; then
    echo "skip ${svc}: DATABASE_URL already set"
    continue
  fi

  password=$(openssl rand -hex 32)
  role="${svc}_svc"
  db="${svc}_db"

  psql -v ON_ERROR_STOP=1 -q \
    -v role="$role" -v db="$db" -v pw="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
ALTER ROLE :"role" WITH LOGIN PASSWORD :'pw';
GRANT :"role" TO CURRENT_USER;
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'role')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
SQL

  url="postgresql://${role}:${password}@${RDS_ENDPOINT}:5432/${db}?sslmode=require"
  updated=$(jq --arg url "$url" '. + {DATABASE_URL: $url}' <<<"$current")
  aws secretsmanager put-secret-value --secret-id "$secret_id" --secret-string "$updated" >/dev/null
  echo "ok ${svc}: ${db} owned by ${role}, DATABASE_URL written to ${secret_id}"
done
