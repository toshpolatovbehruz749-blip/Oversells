# Backups and restore

Oversells keeps its data in two places. Both must be backed up, at the same
time, and restored together:

| What | Where | Contents |
|---|---|---|
| **PostgreSQL** | `db` service, volume `db-data` | users, sessions, projects and file metadata, the live editing history of every text file (`DocUpdate`), comments, versions (metadata), compile jobs, AI usage |
| **File storage** | MinIO bucket (`S3_BUCKET`, volume `minio-data`), or `DATA_DIR` with `STORAGE_DRIVER=local` | file contents (`projects/<id>/files/…`), version snapshots (`projects/<id>/versions/…`), compile outputs (PDF, log, SyncTeX), template previews |

Redis holds nothing that needs a backup (messages between app instances and
rate-limit counters only). Compile outputs and template previews can be
regenerated; everything else cannot.

The text of a file that is being edited lives in PostgreSQL first (the
`DocUpdate` rows) and is mirrored to storage within about a second, so the
database is the more important half: with only a database backup, every text
file can be recovered; uploaded images and PDFs cannot.

## What to back up, how often

- **Database: daily full dump**, kept for 30 days (plus weekly ones for a
  year). `pg_dump` is consistent while the app runs; no downtime is needed.
- **Storage: daily sync** of the bucket to a different machine or provider,
  with versioning or a 30-day retention on the target.
- Take the storage copy **after** the database dump. Objects that are newer
  than the dump are harmless; objects missing for rows in the dump are not.
- Keep at least one copy **off the server** (another provider, an external
  disk). A backup on the same disk does not survive the disk.
- **Test a restore** every few months on a spare machine (see below).

## One-person server (`deploy/install.sh`)

Every night at 03:15 the cron job of `deploy/install.sh` writes into
`backups/` next to the repository:

| File | Contents |
|---|---|
| `oversells-YYYY-MM-DD.dump` | the database (`pg_dump`, custom format) |
| `oversells-files-YYYY-MM-DD.tar.gz` | the files (the `app-data` volume: file contents, versions, PDFs) |
| `oversells-YYYY-MM-DD.zip` | a ZIP of all projects, written by the app (`BACKUP_DIR`) — for «Tiklash» on the projects page |

All are kept 14 days. They are on the same disk as the server: copy them off
it too (the provider's server backups, or `scp`/`rclone` to another machine).

**Restore everything** (a new server, or after a disaster), from the
repository folder, with the dump and the files of the same night:

```bash
sudo bash deploy/install.sh                       # a running, empty Oversells
C="docker compose -f docker-compose.single.yml --env-file .env.production"
$C stop app worker
$C exec -T db dropdb -U oversells oversells
$C exec -T db createdb -U oversells oversells
$C exec -T db pg_restore -U oversells -d oversells --no-owner < backups/oversells-2026-11-03.dump
$C run --rm --no-deps --entrypoint sh app -c 'rm -rf /data/* && tar -xzf - -C /data' < backups/oversells-files-2026-11-03.tar.gz
$C start app worker
```

**Restore some projects only**: log in, «Tiklash» on the projects page, choose
the day's `oversells-YYYY-MM-DD.zip` (or a ZIP of one project folder); the
projects come back as new projects of that account.

This restore was rehearsed on 2026-11-03 (database dropped and files deleted,
then restored from the dump and the archive: login, project and file contents
back).

## Database

Dump (custom format, compressed), from the directory with `docker-compose.prod.yml`:

```bash
mkdir -p backups
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U oversells -d oversells --format=custom --no-owner \
  > "backups/oversells-$(date +%F).dump"
```

Restore into an empty database (stop the app and worker first):

```bash
docker compose -f docker-compose.prod.yml stop app worker
docker compose -f docker-compose.prod.yml exec -T db \
  dropdb -U oversells --if-exists oversells
docker compose -f docker-compose.prod.yml exec -T db createdb -U oversells oversells
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U oversells -d oversells --no-owner < backups/oversells-2026-10-13.dump
docker compose -f docker-compose.prod.yml start app worker
```

The app applies any newer migrations on start, so a dump from an older
version restores into a newer one.

## File storage (MinIO / S3)

With the MinIO client (`mc`) on the backup machine:

```bash
mc alias set oversells https://minio.internal:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
mc alias set offsite  https://s3.backup-provider.example "$KEY" "$SECRET"
mc mirror --overwrite oversells/oversells offsite/oversells-backup
```

`rclone sync` works the same way with any S3 provider. In the production
compose file MinIO is not published to the internet; run the mirror from the
server (`docker run --network oversells-prod_default ...`) or publish the
MinIO port on a private interface only.

Restore: mirror back in the other direction (`mc mirror offsite/oversells-backup oversells/oversells`)
before starting the app.

With `STORAGE_DRIVER=local`, back up `DATA_DIR` (volume `app-data`) with any
file backup tool, e.g. `restic backup /var/lib/docker/volumes/…/_data`.

## Moving from local storage to S3

Installations from before Phase 4 kept files in the `app-data` volume. To
move them into the bucket, run once with the S3 settings of the new setup:

```bash
docker run --rm --network oversells_default -v oversells_app-data:/data \
  -e STORAGE_DRIVER=s3 -e S3_ENDPOINT=http://minio:9000 -e S3_BUCKET=oversells \
  -e S3_ACCESS_KEY_ID=... -e S3_SECRET_ACCESS_KEY=... -e DATABASE_URL=unused://x \
  --entrypoint node oversells-app:latest /app/apps/server/dist/copy-storage.js /data
```

## What is not backed up on purpose

- **Redis** — transient by design (`--save ""`).
- **Caddy** certificates (`caddy-data`) — re-issued automatically; backing
  them up only avoids Let's Encrypt rate limits after a total loss.
- **Old automatic versions** — the retention policy keeps all named versions,
  every automatic version of the last 24 hours, one per day for 30 days, then
  one per week (see PLAN.md, decisions).
