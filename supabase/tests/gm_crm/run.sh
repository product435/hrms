#!/usr/bin/env bash
# Applies the General Manager + Sales CRM migrations to a throwaway database
# built from a minimal stand-in of the live schema, then runs the RLS checks.
#
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/gm_crm/run.sh
# Needs a disposable Postgres 15+ you can create databases on. Never point it
# at the production project: it drops and recreates the database "gm_crm_test".
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
migrations="$here/../../migrations"
db=gm_crm_test

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $db" -c "create database $db"
for role in anon authenticated; do
  psql -q -d postgres -c "do \$\$ begin create role $role nologin; exception when duplicate_object then null; end \$\$;"
done
psql -q -d postgres -c "do \$\$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end \$\$;"

psql -v ON_ERROR_STOP=1 -q -d $db -f "$here/stub_schema.sql"
psql -v ON_ERROR_STOP=1 -q -d $db -f "$migrations/20261102100000_general_manager_role.sql" 2>&1 | grep -v NOTICE || true
psql -v ON_ERROR_STOP=1 -q -d $db -f "$migrations/20261102110000_sales_crm.sql" 2>&1 | grep -v NOTICE || true
# Expected errors are printed inline; compare each "expect_*" column with its value.
psql -q -A -F ' | ' -d $db -f "$here/rls_checks.sql" 2>&1 | grep -v '^set_config\|^1[0-9]\{7\}-\|^(1 row)'
