# Master Subsystem F: DB Backup/Export — Design

**Date:** 2026-08-11
**Status:** Approved, pending plan

## Purpose

Standalone one-click DB backup/export from the Master Control Panel. Master
User pulls a full data dump of the production database on demand, no
scheduling, no external storage — a manual safety net.

## Constraints found during design

- Backend runs on Railway's Node-only buildpack — no `pg_dump` binary
  available (confirmed: `package.json` has only the `pg` driver, no Postgres
  client tools installed, no such dependency exists). Real `pg_dump` is not
  an option without changing the deploy image, which this project has
  already been burned by destabilizing (see Known Fragility in
  `SCOPE_TRACKER.md` — deploy pipeline incidents). Ruled out.
- No streamed-file-download precedent exists yet in this app (the one prior
  CSV export, Supervisor Cluster Reports, builds its CSV client-side from
  already-fetched JSON, no backend download endpoint). This is the first
  backend-streamed-file-to-browser feature.

## Approach

**Hand-rolled SQL export**, generated at request time via the existing `pg`
driver — no new dependency, no buildpack/image change.

### Table scope

Hardcoded whitelist of 14 real, in-use tables:

`staff_roster`, `manager_pins`, `manager_credentials`, `content`, `results`,
`wrong_answers`, `reports`, `ai_results`, `ai_wrong_answers`, `ai_quizzes`,
`standard_questions`, `master_users`, `audit_log`, `system_settings`

Explicitly excluded:
- `rate_limits` — ephemeral, self-resetting, no backup value.
- The confirmed-unused leftover parallel schema (`topics`, `quizzes`,
  `attempts`, `attempt_answers`, `outlets`, `staff`, `resources`,
  `manager_reviews`) — dead tables from an earlier abandoned attempt, never
  read or written by any live code path.

### Dump format

**Data-only** — `INSERT INTO` statements per row, no `CREATE TABLE`. Restore
assumes `sql/schema.sql` has already been applied to the target DB, matching
this project's existing convention (schema.sql is the DDL source of truth,
migration scripts are one-time changes layered on top).

Per table: `SELECT * FROM <table>`, then for each row build one `INSERT INTO
<table> (<columns>) VALUES (<literals>);` line. A generic JS-value → SQL-
literal mapper handles every column type present across the 14 tables
without per-table special-casing:

- `null`/`undefined` → `NULL`
- `number` → bare (e.g. `42`)
- `boolean` → `TRUE` / `FALSE`
- `Date` → `'<ISO 8601 string>'`
- plain object/array (jsonb columns, e.g. `ai_quizzes.questions_json`) →
  `'<JSON.stringify, single-quotes escaped>'::jsonb`
- `string` → `'<value, single-quotes doubled>'`

Whole dump assembled as one in-memory string (data volume is staff/quiz-
history scale — hundreds to low thousands of rows per table, not a
streaming-scale problem) and sent as a file attachment:
`Content-Disposition: attachment; filename="lautan-academy-backup-<ISO
timestamp>.sql"`.

### Backend

New `routes/masterBackup.js`:
- `GET /master/backup-export` — `requireAuth`, `requireMaster` (existing
  middleware, same pattern as every other Master route). Runs the export,
  returns the assembled SQL text with the attachment header above.

No new table, no new migration. Not written to `audit_log` — read-only
export, not an account-management action, consistent with Subsystem E's
established scope (which explicitly logs privileged mutations, not routine
reads).

### Frontend

New `MasterBackupExport.vue`, wired into `MasterPanel.vue`'s already-
disabled `dbBackup` tab (same pattern as every prior subsystem's panel
wiring). Single "Export Backup" button:

- Calls the endpoint via `fetch()` with the master JWT in the
  `Authorization` header — a plain `<a href>` can't carry a custom header,
  so this can't be a static link.
- Response consumed as a `Blob`, turned into a temporary `URL.createObjectURL`,
  downloaded via a programmatically-clicked, then-removed `<a>` element.
- Loading state while the request is in flight, error state on failure
  (network error or non-200 — e.g. an expired master session).
- EN/MS strings per existing bilingual convention.

## Known gap, explicitly out of scope for this subsystem

`master_users` exists as a live table (created via
`scripts/migrate-add-master-users.js`) but was never added to
`sql/schema.sql` — so applying `schema.sql` alone to an empty DB would not
recreate it. This means a from-scratch restore using this export's data-only
dump would fail on the `master_users` INSERT statements until that table is
created some other way. Flagged, not fixed here — user explicitly chose not
to fold this into Subsystem F's scope.

## Testing / verification plan

- `curl` round-trip: call the endpoint with a real master token, confirm the
  response is well-formed SQL (spot-check a few INSERT lines against known
  rows), confirm `Content-Disposition` header is present and correct.
- Confirm 401/403 without a valid master token.
- Confirm jsonb columns (`ai_quizzes.questions_json`) round-trip correctly —
  cast syntax parses, content matches source row.
- Confirm string escaping handles a value containing a literal `'`
  (apostrophe) without breaking the generated SQL — this app has real BM/EN
  text content likely to contain apostrophes.
- `npm run build` clean (frontend).
- Live browser click-through: click Export Backup, confirm a `.sql` file
  downloads with sensible content, both EN and MS UI.
