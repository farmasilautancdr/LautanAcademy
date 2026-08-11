# Master Subsystem E — Audit Logs

Date: 2026-08-11
Status: Approved, pending plan

## Problem

Master User / Super Admin build (see `2026-08-10-master-admin-subsystem-a-design.md`) is decomposed into 8 subsystems (A-H). Subsystem E adds an audit trail for privileged/admin actions across the app — a way for Master to see who did what, when, without shelling into Postgres. Subsystem C (`master_delete_log`) already started this pattern for purge actions only; E generalizes it to every admin-relevant write in the backend.

## Scope decisions (this session)

**What gets logged — privileged/admin actions only, not staff activity:**
- Staff CRUD: add, reset-pin, delete (`staff.js`)
- Content: add, delete (`content.js` — `/upload` itself is not logged, it only uploads a file and returns a URL; the resulting content row is created via the separate add call, which is logged)
- Reports: create/update (`reports.js`)
- Manager credential actions: manager-register, rotate-master-pin, master-reset-supervisor-pin (`auth.js`)
- Master login: `master-login` success only (`auth.js`)
- Maintenance toggle (`maintenance.js`)
- All 5 existing purge routes (`masterPurge.js`) — migrated onto this table, behavior unchanged

**Explicitly excluded** (discussed and rejected this session):
- Staff quiz submissions (`data.js` `/results`, `/ai-results`) — already tracked in `results`/`ai_results`, high-volume, not a security-relevant action.
- AI quiz create/end (`quiz.js`) — routine per-session manager action, not account/data-management sensitive, would add high-volume noise.
- Staff and manager logins (`auth.js` `/staff-login`, `/manager-login`) — shared-PIN, extremely high volume, not account-management actions. `rate_limits` already tracks failed-attempt lockouts separately. `master-login` is the one login logged, since it's rarer and higher-privilege.

**Detail level:** actor + action + one-line human-readable summary + optional affected-row count. No before/after value diffing — matches `master_delete_log`'s existing convention, sufficient to answer "who did what when," avoids the extra code and storage cost of capturing full row state at every call site.

**Failure behavior:** logging is fail-open for standalone routes — if the `audit_log` insert fails, the real action (e.g. staff delete) still succeeds, the log error is caught and console-logged only. Purge routes keep their existing transactional all-or-nothing behavior unchanged (log write and data write commit or roll back together, as they already do) — this isn't a new failure mode, just unchanged from Subsystem C.

**Out of scope:** before/after value diffs, log retention/archival policy, exporting the log, any change to what data purge/PIN-reset/maintenance actions themselves do (E only adds logging around them).

## Design

### Data model

New table, replacing `master_delete_log`:

```sql
create table audit_log (
  id bigserial primary key,
  actor_type text not null,
  actor_key text not null,
  action text not null,
  summary text not null,
  affected_count integer,
  created_at timestamptz not null default now()
);
create index audit_log_created_at_idx on audit_log (created_at desc);
```

- `actor_type` — the session's `scopeType`: `master`, `outlet_manager`, `warehouse_manager`, `area_manager`, or `supervisor`.
- `actor_key` — the session's `scopeKey`: master username, outlet code, area id, or `'ALL'` (supervisor).
- `action` — short dot-namespaced code, e.g. `staff.add`, `staff.delete`, `content.delete`, `report.create`, `purge.staff`, `maintenance.toggle`, `master.login`.
- `summary` — one human-readable line, same style `master_delete_log.summary` already uses (e.g. `"Deleted 3 staff account(s): OUTLET05/AHMAD, ..."`).
- `affected_count` — nullable row count, populated where it means something (purges, staff/content deletes); null for actions like a PIN rotation or a login where a count isn't meaningful.

Migration: copy every `master_delete_log` row into `audit_log` (`actor_type='master'`, `actor_key=master_username`, `action='purge.'||entity_type`, `summary`, `affected_count=deleted_count`), then drop `master_delete_log`.

### Backend

New shared helper, `src/services/auditLog.js`:

```js
export async function logAudit(dbOrClient, { actorType, actorKey, action, summary, affectedCount = null }) {
  try {
    await dbOrClient.query(
      'insert into audit_log (actor_type, actor_key, action, summary, affected_count) values ($1,$2,$3,$4,$5)',
      [actorType, actorKey, action, summary, affectedCount]
    );
  } catch (err) {
    console.error('logAudit failed:', err.message);
  }
}
```

Accepts either `pool` (standalone routes, catches its own errors — fail open) or a transaction `client` (purge routes — the `try/catch` still applies, but since purge routes already wrap `logDelete`/`logAudit` inside their own `withTransaction`, an insert failure there throws up through the transaction as it already does today, causing a rollback of the whole purge; this is intentional, unchanged Subsystem C behavior, not a regression introduced by E). Every standalone call site invokes `logAudit` after its real write succeeds and does not await/require it to succeed before responding.

Call sites updated (11 handlers, each gets one `logAudit(pool, {...})` call after its write, using `req.session.scopeType`/`req.session.scopeKey` as actor):

- `staff.js`: `POST /` → `staff.add`; `POST /reset-pin` → `staff.reset_pin`; `DELETE /` → `staff.delete`
- `content.js`: `POST /` → `content.add`; `DELETE /:id` → `content.delete`
- `reports.js`: `POST /` → `report.create` or `report.update` (based on `existing`/`isEdit`)
- `auth.js`: `POST /manager-register` → `manager.register`; `POST /rotate-master-pin` → `manager.rotate_pin`; `POST /master-reset-supervisor-pin` → `master.reset_supervisor_pin`; `POST /master-login` (on success only) → `master.login`
- `maintenance.js`: `POST /master/maintenance` → `maintenance.toggle`

`masterPurge.js`: `logDelete()` is renamed to call `logAudit(client, { actorType: 'master', actorKey: req.session.scopeKey, action: 'purge.'+entityType, summary, affectedCount: deletedCount })` — same call sites, same transaction placement, just pointed at the new table/helper.

New route file `src/routes/auditLog.js`:

```
GET /master/audit-log/search   (requireAuth, requireMaster)
```

Query params: `actorType`, `actorKey` (partial match), `action` (partial match), `dateFrom`, `dateTo` — same filter-building pattern as `masterPurge.js`'s search routes. Returns up to 200 rows, `order by created_at desc`. Mounted in `index.js`:

```js
app.use('/master/audit-log', auditLogRouter);
```

(alongside `/master/purge`, no `checkMaintenance` — Master's own routes are always reachable, same reasoning as the existing exemption.)

### Frontend

- `MasterAuditLog.vue` — new component, wired into `MasterPanel.vue`'s already-reserved `auditLogs` tab (add to `ENABLED_TABS`). Filter fields: actor type (dropdown), actor key (text), action (text), date range (two date inputs). Calls `GET /master/audit-log/search` with `masterAuth.token`, renders a table (timestamp, actor, action, summary, affected count) — same shape as `MasterDataPurge`'s search-result tables. Read-only, no row actions.
- `api/client.js` addition: `searchAuditLog(filters, masterToken)`.
- Bilingual EN/MS strings under `masterPanel.auditLogs.*`.

## Error handling

- `GET /master/audit-log/search` with no filters → returns the 200 most recent rows across all actions, not an error.
- `logAudit` insert failures never propagate to the caller for standalone routes — caught, logged to console, the real action's response is unaffected.
- Purge routes: an `audit_log` insert failure inside `withTransaction` rolls back the whole purge, same as today's `master_delete_log` behavior — not a new failure mode.
- `requireMaster` failure on the new search route → 403, existing middleware behavior, unchanged.

## Testing / verification plan

- Migration: confirm every pre-existing `master_delete_log` row appears in `audit_log` with matching `actor_key`/`summary`/`affected_count`, then confirm `master_delete_log` is dropped.
- curl: each of the 11 new call sites (staff add/reset-pin/delete, content add/delete, report create + update, manager-register, rotate-master-pin, master-reset-supervisor-pin, successful master-login, maintenance toggle) produces exactly one new `audit_log` row with the right `actor_type`/`actor_key`/`action`/`summary`. Purge routes re-verified end-to-end (search → delete → confirm row in `audit_log`, not `master_delete_log`). `GET /master/audit-log/search` filter combinations (actorType, actorKey partial match, action partial match, date range), 403 without a master token.
- Frontend: `npm run build` clean after each task, EN/BM key-parity clean, live browser click-through — trigger a handful of the logged actions from each relevant role, confirm they appear in the Master Panel's Audit Logs tab with correct filters, both EN and MS.

## Out-of-scope confirmation

Before/after value diffs, log retention/archival, log export, and any change to the underlying behavior of purge/PIN-reset/maintenance/staff/content/reports actions are explicitly not part of this subsystem — E only adds logging around existing actions. Subsystems F-H remain untouched, each gets its own brainstorm/spec/plan cycle in the agreed build order.
