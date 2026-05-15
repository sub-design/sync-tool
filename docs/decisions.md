# Decisions

## One-way sync deletion policies

We keep one-way sync deletion behavior explicit because each policy has a
different data-loss profile.

### 1. Backup

Copy new and updated files from source to destination. Do not delete anything
from destination when files disappear from source.

This is the safest default for backups: deleting a file from the source should
not silently remove the backup copy.

Implementation value: `deletionPolicy: "backup"`.

### 2. Backup with deletes

Copy new and updated files from source to destination. If a file or directory
was previously synced by this job and later disappears from source, remove it
from destination.

Files created only in destination are ignored. This requires job state so the
engine can tell synced files apart from destination-only files.

Implementation value: `deletionPolicy: "backup-with-deletes"`.

For existing one-way jobs that did not previously store state, the first run
after enabling this policy records the manifest. Deletions made before that
manifest exists are not inferred.

### 3. Mirror

Make destination match source exactly. Copy new and updated source files, and
remove everything in destination that does not exist in source.

This is useful when destination is dedicated to this job, but it is the most
destructive policy. It should be presented as a separate mode with clear UI
wording.

Implementation value: `deletionPolicy: "mirror"`.

## Safe delete

Deletes should use the existing safe-delete behavior by default: move removed
files into `_syncdata_/_saved_` instead of hard-deleting them immediately.

This gives users a recovery path while still allowing sync policies to propagate
deletions intentionally.
