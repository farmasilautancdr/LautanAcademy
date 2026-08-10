# Master Subsystem C — Test-Data Purge / Hard Delete

Date: 2026-08-11
Status: Approved, pending plan

## Problem

Master User / Super Admin build (see `2026-08-10-master-admin-subsystem-a-design.md`) is decomposed into 8 subsystems (A-H). Subsystem C is "test-data purge + hard delete" — no schema currently marks any row as test data (confirmed: no `is_test`/`test_data` flag anywhere in `sql/schema.sql`). Test accounts and attempts (e.g. the `LOADTEST01-20` load-test accounts, or ad-hoc accounts created while testing a feature) today can only be cleaned up by someone with direct DB access running a manual script. Master needs a UI to find and permanently remove this data without shell/DB access.

## Scope decisions (this session)

**In scope**, four entity types, each independently searchable and bulk-deletable:
1. **Staff accounts** — `staff_roster` row + cascade to that staff's `results`, `wrong_answers`, `ai_results`, `ai_wrong_answers`, `reports` (matched by outlet+name, since these tables have no FK to `staff_roster` — text match, same as every other query in this codebase).
2. **Quiz attempt records** — individual `results`/`ai_results` rows (and their `wrong_answers`/`ai_wrong_answers`) without touching the staff account itself.
3. **Manager/outlet accounts** — `manager_credentials` rows only (per-outlet/area personal login accounts). **`manager_pins` (the role-level shared PIN — supervisor/area_manager/outlet_manager/resources) is explicitly excluded** — it's a singleton row per role, not a per-account record; deleting it would lock out that entire role company-wide with no recovery path from this tool. `manager_pins` stays managed exclusively by the existing rotate/reset flows (`rotate-master-pin`, Subsystem B).
4. **Reports + Content** — `reports` and `content` rows, simple id-based delete, no cascade.

**Discovery method:** manual search (outlet/name/topic/date-range filters per entity type), no new tagging schema. Matches how `LOADTEST01-20` cleanup was previously done by hand.

**Selection mode:** search → multi-select checkboxes → single bulk delete, not one-at-a-time.

**Confirm flow:** type-to-confirm. Modal shows the exact row-count breakdown across every affected table before the confirm button is enabled; user must type the literal word `DELETE` to enable it.

**Interim audit trail:** Subsystem E (audit logs) isn't built yet. Rather than ship hard-delete with zero trace, this subsystem adds one small `master_delete_log` table (who/what/when/counts) scoped just to its own deletes. Superseded/folded into Subsystem E once that's built — not removed now.

**Out of scope:** any tagging/flagging system for marking rows as test data at creation time, `manager_pins` deletion, `master_users` deletion, any change to `requireScope`/`requireAuth`.

## Design

### Data model

New table:

```sql
create table if not exists master_delete_log (
  id bigserial primary key,
  master_username text not null,
  entity_type text not null,  -- 'staff' | 'quiz_attempt' | 'manager_account' | 'report' | 'content'
  summary text not null,      -- human-readable breakdown of what was deleted
  deleted_count int not null, -- total rows removed across all affected tables
  created_at timestamptz not null default now()
);
```

Every delete (of any entity type) writes exactly one row here, inside the same transaction as the delete itself.

### Backend

New file `routes/masterPurge.js`, mounted under `/master/purge`. Every route: `requireAuth, requireMaster`. Chosen over splitting into each domain's existing route file (`staff.js`/`data.js`/`reports.js`/`content.js`/`auth.js`) — keeping all hard-delete logic in one file makes this high-risk surface easier to audit as a unit, outweighing domain-grouping convention here.

**Staff accounts**
```
GET  /master/purge/staff/search?outlet=&name=
POST /master/purge/staff/delete   Body: { ids: [staff_roster.id, ...] }
```
Search returns matching `staff_roster` rows plus a `relatedCounts` object per row (counts from `results`/`wrong_answers`/`ai_results`/`ai_wrong_answers`/`reports` matching that outlet+name) so the UI can preview cascade size before delete is even requested.
Delete: per selected staff, in one transaction — delete matching rows from all 5 related tables, then the `staff_roster` row itself. Aggregate counts across the whole batch into one `master_delete_log` row.

**Quiz attempt records**
```
GET  /master/purge/quiz-attempts/search?type=standard|ai&outlet=&name=&topic=&dateFrom=&dateTo=
POST /master/purge/quiz-attempts/delete   Body: { type: 'standard'|'ai', ids: [...] }
```
Search returns `results` or `ai_results` rows (`type` selects which) with a `hasAttemptId` flag per row.
Delete: for each row — if `attempt_id` is present, delete the results/ai_results row plus matching `wrong_answers`/`ai_wrong_answers` by `attempt_id`. If `attempt_id` is null (legacy pre-migration row), delete only the results/ai_results row itself; matching wrong_answers is left in place rather than risk deleting an unrelated attempt's data via a topic-only match. UI marks legacy rows with a "no attempt link — wrong answers won't be removed" badge before selection.

**Manager/outlet accounts**
```
GET  /master/purge/manager-accounts/search?role=&scopeKey=
POST /master/purge/manager-accounts/delete   Body: { ids: [manager_credentials.id, ...] }
```
`role` restricted server-side to `outlet_manager`/`warehouse_manager`/`area_manager` (the three roles `manager_credentials` actually holds — `supervisor`/`resources` don't have per-account rows). No cascade — these are standalone login rows.

**Reports + Content**
```
GET  /master/purge/reports/search?outlet=&staffName=&topic=
POST /master/purge/reports/delete   Body: { ids: [reports.id, ...] }
GET  /master/purge/content/search?category=&topic=
POST /master/purge/content/delete   Body: { ids: [content.id, ...] }
```
Simple id-based delete, no cascade, one `master_delete_log` row per batch.

All delete endpoints return `{ status: 'ok', deletedCount, logId }` or `{ status: 'error', error }`. No rate limiting needed beyond the existing `requireMaster` gate — consistent with Subsystem B's PIN reset (master session is already the elevated-privilege boundary).

### Frontend

- `MasterPanel.vue`'s `dataPurge` tab (currently a disabled "Coming Soon" row, id already reserved in `TABS`) becomes clickable, opens `MasterDataPurge.vue`.
- **Drawer width:** only when `activeTab === 'dataPurge'`, the panel's container widens from `max-w-sm` to `max-w-3xl` (other tabs unaffected). Result tables scroll horizontally (`overflow-x-auto`) on narrow viewports rather than forcing page-level horizontal scroll.
- `MasterDataPurge.vue`: segmented pill sub-tab selector — Staff / Quiz Attempts / Manager Accounts / Reports & Content — each rendering its own small panel component:
  - `PurgeStaffPanel.vue`
  - `PurgeQuizAttemptsPanel.vue`
  - `PurgeManagerAccountsPanel.vue`
  - `PurgeReportsContentPanel.vue` (internal toggle between Reports/Content, since they share this sub-tab)
- Each panel: search form (fields per entity type as above) → results table with a checkbox column → "Delete Selected (n)" button, disabled until at least one row is checked → opens shared `MasterDeleteConfirmModal.vue`.
- `MasterDeleteConfirmModal.vue`: props `title`, `breakdown` (array of `{ label, count }` rows, e.g. "Staff accounts: 3", "Quiz results: 41", "Wrong answers: 118"), `onConfirm`. Renders the breakdown, a text input the user must type `DELETE` into, confirm button disabled until the input matches exactly.
- On success: results table refreshes (deleted rows drop out), inline success message with the count removed.
- `api/client.js`: one named function per endpoint (`masterSearchStaffForPurge`, `masterDeleteStaff`, `masterSearchQuizAttempts`, `masterDeleteQuizAttempts`, `masterSearchManagerAccounts`, `masterDeleteManagerAccounts`, `masterSearchReports`, `masterDeleteReports`, `masterSearchContent`, `masterDeleteContent`), all taking `masterAuth.token` as `Authorization: Bearer`, following the existing `masterResetSupervisorPin` shape.
- Bilingual EN/MS strings under `masterPanel.dataPurge.*`, following the existing flat-namespace-per-view convention.

## Error handling

- Empty/invalid search filters → return empty result set, not an error (search is always safe, read-only).
- `ids` array empty or missing on any delete route → 400, nothing touched.
- `requireMaster` failure (expired/missing/non-master token) → 403, handled by existing middleware.
- Any delete transaction failure → full rollback (no partial cascade), 500, no `master_delete_log` row written since nothing was actually deleted.
- Legacy quiz-attempt rows without `attempt_id`: not an error case, handled as a known, surfaced limitation (see Scope decisions).

## Testing / verification plan

- curl per entity type: search returns expected rows + correct `relatedCounts`/`hasAttemptId`, delete removes exactly the targeted rows and cascade rows (verified via row counts before/after), `master_delete_log` gets exactly one row per delete call with correct `deleted_count`, non-master token 403s on every route, empty `ids` 400s.
- Staff cascade: seed a throwaway staff account with results/wrong_answers/ai_results/ai_wrong_answers/reports rows, delete via the endpoint, confirm all rows across all 5 tables are gone and no unrelated staff's rows were touched.
- Legacy quiz-attempt case: seed a `results` row with `attempt_id = null` alongside a real `wrong_answers` row for the same outlet+staff+topic, delete it, confirm the `results` row is gone and the `wrong_answers` row is untouched (not silently deleted).
- Frontend: `npm run build` clean, live browser click-through for all 4 sub-tabs (search, multi-select, confirm modal type-to-enable, delete, table refresh) in EN + MS, drawer-width change confirmed only on `dataPurge` tab.

## Out-of-scope confirmation

`manager_pins` deletion, `master_users` deletion, any test-data tagging/flagging schema, and any change to `requireScope`/`requireAuth` are explicitly not part of this subsystem. Subsystems D-H remain untouched, each gets its own brainstorm/spec/plan cycle in the agreed build order.
