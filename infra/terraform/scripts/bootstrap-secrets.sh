#!/usr/bin/env bash
# Fills the Secrets Manager entries Terraform creates empty, in the shape the
# Helm charts read (docs/operations/deployment.md §3), so no value ever lands in
# Terraform state:
#
#   auracoach/<env>/<service>-service  DATABASE_URL (app role, DML), MIGRATION_DATABASE_URL (owner, DDL), REDIS_URL
#   auracoach/<env>/shared             INTERNAL_TOKEN_SECRET
#   auracoach/<env>/web                SESSION_SECRET, OIDC_CLIENT_SECRET
#   auracoach/<env>/datastores         POSTGRES_PASSWORD, REDIS_PASSWORD, <SERVICE>_DB_PASSWORD (dev, staging)
#
# Common inputs: USER_POOL_ID and WEB_CLIENT_ID (terraform output oidc).
#
# prod also creates one database, owner role <svc>_svc and app role <svc>_app per
# service on RDS, through an SSM port forward via the k3s node:
#   aws ssm start-session --target <k3s_instance_id> \
#     --document-name AWS-StartPortForwardingSessionToRemoteHost \
#     --parameters host=<rds_endpoint>,portNumber=5432,localPortNumber=15432
#   RDS_ENDPOINT=… MASTER_SECRET_ARN=… REDIS_SECRET_ARN=… USER_POOL_ID=… WEB_CLIENT_ID=… \
#     ./bootstrap-secrets.sh prod
#
# dev and staging point the URLs at the in-cluster aura-datastores chart in
# DATASTORE_NAMESPACE (default <env>-aura-data); the chart creates the roles itself.
#
# Idempotent: values already present are kept. ROTATE=1 replaces generated ones.
set -euo pipefail

ENVIRONMENT="${1:?usage: bootstrap-secrets.sh <dev|staging|prod>}"
: "${USER_POOL_ID:?set USER_POOL_ID}"
: "${WEB_CLIENT_ID:?set WEB_CLIENT_ID}"
ROTATE="${ROTATE:-0}"
SERVICES=(profile workout nutrition progress coach notification audit)
PREFIX="auracoach/${ENVIRONMENT}"

get_json() {
  aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text 2>/dev/null || echo '{}'
}

# merge_secret <secret-id> <jq-args...> <filter>: adds keys, keeping existing ones unless ROTATE=1.
merge_secret() {
  local id="$1" current new updated
  shift
  current=$(get_json "$id")
  new=$(jq -c "$@")
  if [[ "$ROTATE" == 1 ]]; then
    updated=$(jq -c --argjson new "$new" '. * $new' <<<"$current")
  else
    updated=$(jq -c --argjson new "$new" '$new * .' <<<"$current")
  fi
  aws secretsmanager put-secret-value --secret-id "$id" --secret-string "$updated" >/dev/null
  echo "ok ${id}: $(jq -r 'keys | join(", ")' <<<"$updated")"
}

has_key() { jq -e --arg k "$2" 'has($k)' <<<"$(get_json "$1")" >/dev/null; }

rand() { openssl rand -hex 32; }

# ---------- shared and web ----------
merge_secret "${PREFIX}/shared" --arg v "$(rand)" -n '{INTERNAL_TOKEN_SECRET: $v}'
client_secret=$(aws cognito-idp describe-user-pool-client --user-pool-id "$USER_POOL_ID" \
  --client-id "$WEB_CLIENT_ID" --query UserPoolClient.ClientSecret --output text)
merge_secret "${PREFIX}/web" --arg s "$(rand)" -n '{SESSION_SECRET: $s}'
# The client secret always follows Cognito, even without ROTATE.
ROTATE=1 merge_secret "${PREFIX}/web" --arg c "$client_secret" -n '{OIDC_CLIENT_SECRET: $c}'

if [[ "$ENVIRONMENT" == prod ]]; then
  : "${RDS_ENDPOINT:?set RDS_ENDPOINT (terraform output rds_endpoint)}"
  : "${MASTER_SECRET_ARN:?set MASTER_SECRET_ARN (terraform output rds_master_secret_arn)}"
  : "${REDIS_SECRET_ARN:?set REDIS_SECRET_ARN (terraform output redis_secret_arn)}"
  master_json=$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" --query SecretString --output text)
  PGUSER=$(jq -r .username <<<"$master_json")
  PGPASSWORD=$(jq -r .password <<<"$master_json")
  export PGUSER PGPASSWORD PGHOST=127.0.0.1 PGPORT="${LOCAL_PORT:-15432}" PGSSLMODE=require
  redis_url=$(jq -r .REDIS_URL <<<"$(get_json "$REDIS_SECRET_ARN")")

  for svc in "${SERVICES[@]}"; do
    id="${PREFIX}/${svc}-service"
    if [[ "$ROTATE" != 1 ]] && has_key "$id" DATABASE_URL; then
      echo "skip ${svc}: database already bootstrapped"
      continue
    fi
    owner="${svc}_svc" app="${svc}_app" db="${svc}_db"
    owner_pw=$(rand) app_pw=$(rand)

    psql -d postgres -v ON_ERROR_STOP=1 -q -v owner="$owner" -v app="$app" -v db="$db" \
      -v owner_pw="$owner_pw" -v app_pw="$app_pw" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'owner') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
ALTER ROLE :"owner" WITH LOGIN PASSWORD :'owner_pw';
ALTER ROLE :"app" WITH LOGIN PASSWORD :'app_pw';
GRANT :"owner" TO CURRENT_USER;
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app";
SQL

    # The app role gets DML on whatever the owner (migrations) creates.
    psql -d "$db" -v ON_ERROR_STOP=1 -q -v owner="$owner" -v app="$app" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"app";
SQL

    ROTATE=1 merge_secret "$id" \
      --arg app "postgresql://${app}:${app_pw}@${RDS_ENDPOINT}:5432/${db}?sslmode=require" \
      --arg mig "postgresql://${owner}:${owner_pw}@${RDS_ENDPOINT}:5432/${db}?sslmode=require" \
      --arg redis "$redis_url" \
      -n '{DATABASE_URL: $app, MIGRATION_DATABASE_URL: $mig, REDIS_URL: $redis}'
  done
else
  ns="${DATASTORE_NAMESPACE:-${ENVIRONMENT}-aura-data}"
  pg_host="postgres.${ns}.svc.cluster.local"
  redis_host="redis.${ns}.svc.cluster.local"
  ds_id="${PREFIX}/datastores"
  args=(--arg pg "$(rand)" --arg redis "$(rand)")
  filter='{POSTGRES_PASSWORD: $pg, REDIS_PASSWORD: $redis}'
  for svc in "${SERVICES[@]}"; do
    upper=$(tr '[:lower:]' '[:upper:]' <<<"$svc")
    args+=(--arg "$svc" "$(rand)")
    filter="${filter} + {${upper}_DB_PASSWORD: \$${svc}}"
  done
  merge_secret "$ds_id" "${args[@]}" -n "$filter"

  ds=$(get_json "$ds_id")
  redis_pw=$(jq -r .REDIS_PASSWORD <<<"$ds")
  for svc in "${SERVICES[@]}"; do
    upper=$(tr '[:lower:]' '[:upper:]' <<<"$svc")
    pw=$(jq -r --arg k "${upper}_DB_PASSWORD" '.[$k]' <<<"$ds")
    url="postgresql://${svc}_svc:${pw}@${pg_host}:5432/${svc}_db"
    # In non-prod one role owns each database, so both URLs use it (deployment.md §3).
    ROTATE=1 merge_secret "${PREFIX}/${svc}-service" --arg u "$url" \
      --arg r "redis://:${redis_pw}@${redis_host}:6379" \
      -n '{DATABASE_URL: $u, MIGRATION_DATABASE_URL: $u, REDIS_URL: $r}'
  done
fi
