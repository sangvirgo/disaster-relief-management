#!/usr/bin/env bash
set -eu

export PGHOST=postgres PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGPASSWORD="$POSTGRES_PASSWORD"
until pg_isready -q; do sleep 1; done

psql -X -v ON_ERROR_STOP=1 <<'SQL'
\getenv identity_migrator_password IDENTITY_MIGRATOR_PASSWORD
\getenv identity_app_password IDENTITY_APP_PASSWORD
\getenv response_migrator_password RESPONSE_MIGRATOR_PASSWORD
\getenv response_app_password RESPONSE_APP_PASSWORD
\getenv logistics_migrator_password LOGISTICS_MIGRATOR_PASSWORD
\getenv logistics_app_password LOGISTICS_APP_PASSWORD

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'identity_migrator', :'identity_migrator_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_migrator') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'identity_app_login', :'identity_app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_app_login') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'response_migrator', :'response_migrator_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'response_migrator') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'response_app_login', :'response_app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'response_app_login') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'logistics_migrator', :'logistics_migrator_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'logistics_migrator') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'logistics_app_login', :'logistics_app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'logistics_app_login') \gexec

SELECT 'CREATE ROLE c48_identity_app NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'c48_identity_app') \gexec
SELECT 'CREATE ROLE c48_response_app NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'c48_response_app') \gexec
SELECT 'CREATE ROLE c48_logistics_app NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'c48_logistics_app') \gexec
SELECT 'CREATE ROLE c48_logistics_owner NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'c48_logistics_owner') \gexec

GRANT c48_identity_app TO identity_app_login;
GRANT c48_response_app TO response_app_login;
GRANT c48_logistics_app TO logistics_app_login;
GRANT c48_logistics_owner TO logistics_migrator;

ALTER ROLE identity_migrator SET lock_timeout = '3s';
ALTER ROLE identity_migrator SET statement_timeout = '8s';
ALTER ROLE identity_migrator SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE identity_app_login SET lock_timeout = '3s';
ALTER ROLE identity_app_login SET statement_timeout = '8s';
ALTER ROLE identity_app_login SET idle_in_transaction_session_timeout = '10s';

ALTER ROLE response_migrator SET lock_timeout = '3s';
ALTER ROLE response_migrator SET statement_timeout = '8s';
ALTER ROLE response_migrator SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE response_app_login SET lock_timeout = '3s';
ALTER ROLE response_app_login SET statement_timeout = '8s';
ALTER ROLE response_app_login SET idle_in_transaction_session_timeout = '10s';

ALTER ROLE logistics_migrator SET lock_timeout = '3s';
ALTER ROLE logistics_migrator SET statement_timeout = '8s';
ALTER ROLE logistics_migrator SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE logistics_app_login SET lock_timeout = '3s';
ALTER ROLE logistics_app_login SET statement_timeout = '8s';
ALTER ROLE logistics_app_login SET idle_in_transaction_session_timeout = '10s';

SELECT format('CREATE DATABASE %I OWNER %I', 'c48_identity', 'identity_migrator')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'c48_identity') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'c48_response', 'response_migrator')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'c48_response') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'c48_logistics', 'logistics_migrator')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'c48_logistics') \gexec
SQL

psql -X -v ON_ERROR_STOP=1 -d c48_identity -c 'CREATE EXTENSION IF NOT EXISTS citext'
psql -X -v ON_ERROR_STOP=1 -d c48_response -c 'CREATE EXTENSION IF NOT EXISTS postgis'
psql -X -v ON_ERROR_STOP=1 -d c48_logistics -c 'CREATE EXTENSION IF NOT EXISTS postgis'
