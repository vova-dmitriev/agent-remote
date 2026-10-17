#!/bin/sh
set -eu
umask 077
backup_dir="${1:?Usage: backup-db.sh OUTPUT_DIRECTORY}"
mkdir -p "$backup_dir"
backup_file="$backup_dir/claude-remote-$(date -u +%Y%m%dT%H%M%SZ).dump"
backup_database="${BACKUP_DATABASE:-claude_remote}"
backup_user="${BACKUP_USER:-claude_remote}"
if ! docker compose exec -T postgres pg_dump -U "$backup_user" -d "$backup_database" -Fc > "$backup_file"; then
  rm -f "$backup_file"
  exit 1
fi
find "$backup_dir" -type f -name 'claude-remote-*.dump' -mtime +6 -delete
printf '%s\n' "$backup_file"
