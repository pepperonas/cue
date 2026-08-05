#!/bin/sh
# Nightly backup of cue's SQLite database + screenshot attachments.
#
# Runs on the VPS via cue-backup.timer (see the units next to this file).
#
# WHY sqlite3 .backup AND NOT cp — two reasons, stated as precisely as they
# were actually verified:
#
#  1. `cp` is not atomic. Pages can change while it reads, so a copy taken
#     during a write can be internally inconsistent, and nothing reports it.
#     `.backup` uses SQLite's online backup API, which produces a consistent
#     snapshot while the app keeps writing.
#  2. cue runs in WAL mode, and the write-ahead log holds committed
#     transactions that are not in the main file yet — here it was 4.4 MB
#     against a 4.2 MB database. Copying cue.db ALONE therefore restores to
#     whatever was last checkpointed. Measured once on the live database, that
#     happened to be fully current (auto-checkpointing keeps it close), so this
#     is a risk of losing the newest writes, not a guarantee of losing them —
#     but it is a risk taken for no gain, and it fails silently when it hits.
#
# `.backup` also sidesteps the -wal/-shm bookkeeping entirely: the result is a
# single self-contained file.
#
# Running from the HOST against the Docker volume, not through `docker exec`,
# is deliberate: it still works when the container is down, which is exactly
# when a backup tends to matter.
#
# RESTORE:
#   systemctl stop docker-compose@cue  # or: cd /opt/cue && docker compose down
#   gunzip -c /var/backups/cue/cue-YYYY-MM-DD.db.gz \
#     > /var/lib/docker/volumes/cue_cue-data/_data/cue.db
#   rm -f /var/lib/docker/volumes/cue_cue-data/_data/cue.db-wal \
#         /var/lib/docker/volumes/cue_cue-data/_data/cue.db-shm
#   tar -xzf /var/backups/cue/cue-attachments-YYYY-MM-DD.tar.gz \
#     -C /var/lib/docker/volumes/cue_cue-data/_data
#   cd /opt/cue && docker compose up -d
# Deleting the stale -wal/-shm matters: they belong to the REPLACED database
# and SQLite would try to apply them to the restored one.
set -eu

DATA="${CUE_DATA_DIR:-/var/lib/docker/volumes/cue_cue-data/_data}"
DEST="${CUE_BACKUP_DIR:-/var/backups/cue}"
KEEP_DAYS="${CUE_BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%F)"

[ -f "$DATA/cue.db" ] || { echo "no database at $DATA/cue.db" >&2; exit 1; }
mkdir -p "$DEST"

TMP="$DEST/cue-$STAMP.db"
sqlite3 "$DATA/cue.db" ".backup '$TMP'"

# Verify before keeping it: a corrupt copy that rotation later treats as a
# valid generation is worse than a missing one, because it hides the gap.
if [ "$(sqlite3 "$TMP" 'PRAGMA integrity_check;')" != "ok" ]; then
  echo "integrity check failed for $TMP" >&2
  rm -f "$TMP"
  exit 1
fi

gzip -f "$TMP"

# The database rows reference these files by name; without them a restore
# yields prompts with broken screenshots.
if [ -d "$DATA/attachments" ]; then
  tar -czf "$DEST/cue-attachments-$STAMP.tar.gz" -C "$DATA" attachments
fi

find "$DEST" -maxdepth 1 -name 'cue-*.gz' -mtime "+$KEEP_DAYS" -delete

echo "backup ok: $(ls -lh "$DEST/cue-$STAMP.db.gz" | awk '{print $5}') db, $(ls -1 "$DEST" | wc -l) files kept"
