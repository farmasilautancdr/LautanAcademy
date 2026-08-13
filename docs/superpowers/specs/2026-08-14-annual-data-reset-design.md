# Annual Data Reset

Date: 2026-08-14
Status: Approved, pending plan

## Problem

Supabase free tier caps database storage at 500MB and egress at 5GB/month. `results`/`wrong_answers`/`ai_results`/`ai_wrong_answers`/`reports`/`audit_log` grow forever with no retention policy — every quiz attempt and audit event across 50+ outlets accumulates indefinitely. Two specific costs grow with this: Supervisor/Area Manager "All Time" views and CSV export run `select *` with no `LIMIT` (see `data.js`), so their egress cost scales with total historical rows, not per-request; and raw DB storage itself approaches the 500MB cap over multiple years. Master needs a way to archive a year's data (via the existing Backup & Export SQL dump) and then clear it out of the live database, without breaking any in-app functionality that depends on current data.

**Confirmed non-dependency:** CPD Hours (`cpdHoursThisYear()` in `data.js`) already filters to `extract(year from created_at) = extract(year from now())` — it recomputes live from the DB and only ever looks at the current calendar year. Deleting prior years' rows does not change any CPD number.

## Scope decisions (this session)

**Cutoff:** everything dated before Jan 1 of the current year (`created_at < date_trunc('year', now())`), not a rolling 365-day window — predictable, and lines up with CPD Hours' own existing Jan-1 reset.

**Tables in scope** (6, no FK constraints between any of them — confirmed against `sql/schema.sql`, delete order doesn't matter for integrity):
- `results`, `wrong_answers`, `ai_results`, `ai_wrong_answers`, `reports` (the quiz-attempt history driving the egress/storage concern)
- `audit_log` (also grows forever; included per explicit ask, accepting the loss of prior-years' audit trail — this year's actions, including the reset action itself, are unaffected since they're dated "now")

**Explicitly untouched:** `staff_roster`, `manager_pins`, `manager_credentials`, `content`, `ai_quizzes`, `standard_questions`, `areas`, `store_outlets`, `system_settings`, `sessions`, `master_users`, `master_delete_log`. Nobody re-registers, no config or question bank is lost — this is a quiz-history + audit-trail reset only, not a full wipe.

**Trigger:** manual only, Master Panel, no cron/automation. Master must click "Export Backup" first — this is a **hard gate**, not a warning: the Reset button stays disabled until a backup export succeeds in that same panel visit (client-side flag, not persisted across navigation/reload — leaving and coming back requires exporting again).

**Confirm flow:** same type-`DELETE`-to-confirm modal (`MasterDeleteConfirmModal.vue`) every other Purge action already uses, showing a per-table row-count breakdown fetched live before delete.

**Out of scope:** any change to the "All Time" queries' missing `LIMIT` (a separate, unrelated fix if ever pursued — this spec only addresses retention, not query shape), any tagging/flagging schema, any automation/scheduling.

## Design

### Backend

New file `routes/masterAnnualReset.js`, mounted under `/master/annual-reset`. Both routes: `requireAuth, requireMaster`. Kept separate from `masterPurge.js` — this operates on a date cutoff across fixed tables, not a search-then-select-then-delete flow, different enough shape to not force into the existing file.

```
GET  /master/annual-reset/preview
POST /master/annual-reset
```

**Preview** (read-only): runs one `count(*)` per of the 6 tables where `created_at < date_trunc('year', now())`, returns `{ counts: { results, wrongAnswers, aiResults, aiWrongAnswers, reports, auditLog }, cutoff: <ISO date used> }`. Safe to call any number of times, no side effects.

**Reset**: one transaction (`withTransaction` — this codebase's convention is a small file-local copy per route file, not a shared import; see `masterSessions.js`'s own copy and its comment confirming this is deliberate) —
1. `delete from <table> where created_at < date_trunc('year', now())` for each of the 6 tables, capturing `rowCount` per table.
2. Inside the same transaction, `logAudit(client, { actorType: 'master', actorKey: <master username>, action: 'master.annual_reset', summary: '<per-table counts>', affectedCount: <sum> })` — this insert lands with `created_at = now()` (this year), so it survives the very cutoff it's describing.
3. Commit. On any failure, full rollback — no partial delete, and (since the audit insert is in the same transaction) no orphaned log entry describing a delete that didn't happen.

Response: `{ status: 'ok', counts: { ...per-table deleted counts }, deletedTotal }`.

No new table needed — `audit_log` already covers this action (once it exists as a row dated this year, per point 2 above).

### Frontend

Extends the existing Backup & Export tab (`MasterBackupExport.vue`) rather than adding a new tab — keeps backup and reset physically paired so the hard-gate reads naturally in the UI.

- New local ref `backedUp = ref(false)` in `MasterBackupExport.vue`, set `true` on a successful `exportBackup()` call (existing button, logic unchanged otherwise). Resets to `false` on component mount (i.e. every fresh visit to the tab).
- New section below the existing export button, **Annual Reset**:
  - On component mount, calls `GET /master/annual-reset/preview` (same pattern `MasterOutletsPanel.vue`'s `load()` already uses), shows the row-count breakdown per table and the computed cutoff date, e.g. "Everything before 1 Jan 2026".
  - **Reset** button: `:disabled="!backedUp"`. When disabled, a small helper line explains why ("Export a backup first").
  - Click (when enabled) opens `MasterDeleteConfirmModal.vue` with the same breakdown fetched from preview, typed-`DELETE` gate.
  - Confirm → `POST /master/annual-reset` → on success, re-run the preview call (counts should now show 0 for the pre-cutoff window), inline success message with `deletedTotal`.
- `api/client.js`: `masterAnnualResetPreview()`, `masterAnnualReset()`, both taking `masterAuth.token`, following the existing `masterResetSupervisorPin`/purge-endpoint shape.
- Bilingual EN/MS strings under `masterPanel.backupExport.annualReset.*`.

## Error handling

- Preview is read-only, always safe — no error states beyond a generic fetch-failure message (same as every other Master Panel search call).
- Reset transaction failure → full rollback, 500, no partial delete, no orphaned audit row (see Backend §2-3 above).
- `requireMaster` failure → 403, existing middleware, no change.
- Frontend hard-gate is a trust boundary, not a security boundary — the backend does not (and cannot) verify a backup actually happened; this matches the trust level every other Master-only destructive action already operates at (Master session itself is the elevated-privilege gate).
- Zero rows to delete (e.g. re-running mid-year, or a brand-new deployment) is not an error — preview and reset both just report 0 for every table.

## Testing / verification plan

- curl: preview returns correct counts against seeded rows with `created_at` both before and after the cutoff (only before-cutoff rows counted); reset deletes exactly the before-cutoff rows across all 6 tables and leaves after-cutoff rows untouched (verified via row counts before/after); the audit_log row for the reset action itself survives (it's dated `now()`); non-master token 403s both routes; reset with zero eligible rows succeeds with all-zero counts, no error.
- Seed test: throwaway rows in each of the 6 tables with `created_at` manually set to two years ago (via direct insert with an explicit timestamp) alongside current-dated rows, confirm only the old ones are removed.
- Frontend: `npm run build` clean, live browser click-through — Reset button disabled before export, enabled immediately after a successful export within the same visit, disabled again after a fresh reload of the tab; typed-`DELETE` modal gate; success message and counts match preview; EN + MS strings render correctly.

## Out-of-scope confirmation

No change to the "All Time" queries' missing `LIMIT`/pagination (separate concern, not addressed here), no automation/cron, no new table, no change to `staff_roster`/`manager_pins`/`manager_credentials`/`content`/`ai_quizzes`/`standard_questions`/`areas`/`store_outlets`/`system_settings`/`sessions`/`master_users`/`master_delete_log`.
