#!/bin/sh
set -eu
archive="${1:?Usage: restore-db.sh ARCHIVE CLEAN_DATABASE_URL}"
target="${2:?Specify a clean test or staging database}"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$target" "$archive"
