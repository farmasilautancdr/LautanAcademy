# Master Subsystem E — Audit Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `audit_log` table and hook it into every privileged/admin write endpoint across the backend, replacing the interim `master_delete_log`, and surface it read-only in the Master Panel's already-reserved `auditLogs` tab.

**Architecture:** One new Postgres table (`audit_log`) + one shared helper (`logAudit()`) called from 11 existing route handlers plus the 5 existing purge routes. A new `GET /master/audit-log/search` endpoint (Master-only) powers a new read-only Vue component wired into the Master Panel drawer, following the exact same search-table pattern the purge sub-panels already use.

**Tech Stack:** Node.js + Express + `pg` (raw SQL, no ORM) on the backend (`lautan-academy-backend`); Vue 3 + Pinia + `vue-i18n` on the frontend (`lautan-academy` repo's `lautan-academy-frontend/` subfolder). No test framework either side — verification is `curl` + `npm run build` + live browser click-through, matching every prior subsystem (A-D).

## Global Constraints

- Bilingual EN/MS required for every new user-facing string (project-wide rule).
- No new frameworks/libraries without asking first.
- Match existing file conventions exactly (see Task notes below — every task points at the real precedent file to copy the shape from).
- Backend repo is `C:\Users\Hafiz\projects\lautan-academy-backend` (sibling repo, NOT a subfolder of the frontend repo). Frontend repo root for this plan's frontend tasks is `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend`.
- Local dev backend DB is the same Postgres as production (Session Pooler vs Direct connection difference only, not a separate DB) — use disposable/throwaway test data for verification (e.g. `d_test_*` staff/manager rows), clean up after each task's curl tests, same convention prior subsystems used.
- Spec: `docs/superpowers/specs/2026-08-11-master-subsystem-e-design.md` — every task below implements one part of it; consult it for full rationale if anything here is ambiguous.

---

### Task 1: `audit_log` table + migration off `master_delete_log`

**Files:**
- Create: `scripts/migrate-add-audit-log.js` (backend repo)
- Modify: `sql/schema.sql:159-169` (backend repo — replace the `master_delete_log` block with the new `audit_log` block, keep it in the same position relative to `system_settings`)

**Interfaces:**
- Produces: table `audit_log(id bigserial pk, actor_type text, actor_key text, action text, summary text, affected_count integer nullable, created_at timestamptz)`, index `audit_log_created_at_idx on audit_log(created_at desc)`. Every later task's `logAudit()` calls write into this table.

- [ ] **Step 1: Write the migration script**

```js
// scripts/migrate-add-audit-log.js
// One-off: creates audit_log (Master Subsystem E), migrates every existing
// master_delete_log row into it, then drops master_delete_log — see
// docs/superpowers/specs/2026-08-11-master-subsystem-e-design.md.
// Safe to re-run (create-if-not-exists, migrate-if-source-exists).
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`
    create table if not exists audit_log (
      id bigserial primary key,
      actor_type text not null,
      actor_key text not null,
      action text not null,
      summary text not null,
      affected_count integer,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create index if not exists audit_log_created_at_idx on audit_log (created_at desc)
  `);

  const { rows: exists } = await pool.query(
    `select 1 from information_schema.tables where table_name = 'master_delete_log'`
  );
  if (exists.length) {
    const { rowCount } = await pool.query(`
      insert into audit_log (actor_type, actor_key, action, summary, affected_count, created_at)
      select 'master', master_username, 'purge.' || entity_type, summary, deleted_count, created_at
      from master_delete_log
    `);
    console.log(`Migrated ${rowCount} row(s) from master_delete_log into audit_log.`);
    await pool.query('drop table master_delete_log');
    console.log('Dropped master_delete_log.');
  } else {
    console.log('master_delete_log already gone, nothing to migrate.');
  }

  console.log('Migration complete: audit_log table ready.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Update `sql/schema.sql`**

Replace lines 159-169 (the `master_delete_log` comment + table block) with:

```sql
-- Audit trail for all privileged/admin actions (Master Subsystem E) —
-- superseded master_delete_log (Subsystem C's interim version, migrated
-- and dropped). One row per logged action, written best-effort (fails
-- open for standalone routes, part of the transaction for purge routes).
create table if not exists audit_log (
  id bigserial primary key,
  actor_type text not null,        -- 'master' | 'outlet_manager' | 'warehouse_manager' | 'area_manager' | 'supervisor'
  actor_key text not null,         -- master username | outlet code | area id | 'ALL'
  action text not null,            -- e.g. 'staff.add', 'content.delete', 'purge.staff', 'master.login'
  summary text not null,
  affected_count integer,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_at_idx on audit_log (created_at desc);
```

- [ ] **Step 3: Run the migration against the dev DB**

Run: `node scripts/migrate-add-audit-log.js` (from the backend repo root)
Expected: prints `Migrated N row(s) from master_delete_log into audit_log.` (N = however many purge actions have been done so far, could be 0), then `Dropped master_delete_log.`, then `Migration complete: audit_log table ready.`

- [ ] **Step 4: Verify via psql/query**

Run a quick one-off check (e.g. `node -e "import('./src/config/db.js').then(async ({pool}) => { const r = await pool.query('select count(*) from audit_log'); console.log(r.rows); const t = await pool.query(\"select 1 from information_schema.tables where table_name='master_delete_log'\"); console.log('master_delete_log exists:', t.rows.length > 0); await pool.end(); })"` from the backend repo root)
Expected: `audit_log` row count matches what was printed in Step 3, `master_delete_log exists: false`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-add-audit-log.js sql/schema.sql
git commit -m "feat: add audit_log table, migrate off master_delete_log"
```

---

### Task 2: `logAudit()` helper + `masterPurge.js` migration (first real usage)

**Files:**
- Create: `src/services/auditLog.js` (backend repo)
- Modify: `src/routes/masterPurge.js` (backend repo — replace `logDelete()` with `logAudit()`, update its 5 call sites)

**Interfaces:**
- Consumes: `pool` from `../config/db.js` (already imported in `masterPurge.js`), `audit_log` table from Task 1.
- Produces: `logAudit(dbOrClient, { actorType, actorKey, action, summary, affectedCount = null })` — an async function, importable as `import { logAudit } from '../services/auditLog.js'`. Every later task calls this exact signature.

- [ ] **Step 1: Write `src/services/auditLog.js`**

```js
import { pool } from '../config/db.js';

// Shared audit-trail writer for every privileged/admin action. Accepts
// either the module-level `pool` (standalone routes — catches its own
// errors, fail-open, never blocks the caller's response) or a transaction
// `client` (purge routes — an insert failure here throws up through the
// caller's own try/catch and rolls back the whole transaction, same
// all-or-nothing behavior master_delete_log already had, not a new
// failure mode). See docs/superpowers/specs/2026-08-11-master-subsystem-e-design.md.
export async function logAudit(dbOrClient = pool, { actorType, actorKey, action, summary, affectedCount = null }) {
  await dbOrClient.query(
    'insert into audit_log (actor_type, actor_key, action, summary, affected_count) values ($1,$2,$3,$4,$5)',
    [actorType, actorKey, action, summary, affectedCount]
  );
}

// Fail-open wrapper for standalone (non-transactional) routes — never
// throws, logs to console on failure instead. Purge routes call logAudit()
// directly (not this) since they need the throw to trigger their rollback.
export async function logAuditSafe(fields) {
  try {
    await logAudit(pool, fields);
  } catch (err) {
    console.error('logAudit failed:', err.message);
  }
}
```

- [ ] **Step 2: Update `masterPurge.js` to use the new helper**

Replace the `logDelete` function (lines 26-31) with an import, and update all 5 call sites. Full diff:

Remove:
```js
async function logDelete(client, masterUsername, entityType, summary, deletedCount) {
  await client.query(
    'insert into master_delete_log (master_username, entity_type, summary, deleted_count) values ($1,$2,$3,$4)',
    [masterUsername, entityType, summary, deletedCount]
  );
}
```

Add near the top imports:
```js
import { logAudit } from '../services/auditLog.js';
```

Replace each call site (5 total — `staff/delete`, `quiz-attempts/delete`, `manager-accounts/delete`, `reports/delete`, `content/delete`) from this shape:
```js
await logDelete(client, req.session.scopeKey, 'staff', summary, totalDeleted);
```
to this shape (one per entity type — `staff`→`purge.staff`, `quiz_attempt`→`purge.quiz_attempt`, `manager_account`→`purge.manager_account`, `report`→`purge.report`, `content`→`purge.content`):
```js
await logAudit(client, { actorType: 'master', actorKey: req.session.scopeKey, action: 'purge.staff', summary, affectedCount: totalDeleted });
```

(Match each call site's existing variable names for `summary`/count — `totalDeleted`, `rowCount`, etc. — exactly as they already appear in each of the 5 handlers; only the function name/shape changes, not the values passed.)

- [ ] **Step 3: Verify via curl — full purge round trip**

Start the backend (`npm run dev` from the backend repo root). Using a real master token (`POST /auth/master-login`) and a throwaway staff row (insert one via `POST /staff-roster-manage` with a manager token, or reuse an existing disposable test account):

```bash
curl -s http://localhost:3000/master/purge/staff/search -H "Authorization: Bearer $MASTER_TOKEN" -G --data-urlencode "outlet=OUTLET_TEST" | jq
curl -s -X POST http://localhost:3000/master/purge/staff/delete -H "Authorization: Bearer $MASTER_TOKEN" -H "Content-Type: application/json" -d '{"ids":[<id from search>]}' | jq
```

Expected: delete call returns `{"status":"ok","deletedCount":N}`. Then confirm a new row landed in `audit_log`:

```bash
node -e "import('./src/config/db.js').then(async ({pool}) => { const r = await pool.query(\"select * from audit_log where action='purge.staff' order by id desc limit 1\"); console.log(r.rows); await pool.end(); })"
```

Expected: one row with `actor_type='master'`, `actor_key` = the master username, `action='purge.staff'`, `summary` matching the delete's summary text, `affected_count` matching `deletedCount`.

- [ ] **Step 4: Commit**

```bash
git add src/services/auditLog.js src/routes/masterPurge.js
git commit -m "feat: add logAudit helper, migrate masterPurge onto audit_log"
```

---

### Task 3: `staff.js` audit hooks (add, reset-pin, delete)

**Files:**
- Modify: `src/routes/staff.js` (backend repo)

**Interfaces:**
- Consumes: `logAuditSafe` from `../services/auditLog.js` (Task 2).

- [ ] **Step 1: Add the import**

At the top of `src/routes/staff.js`, add:
```js
import { logAuditSafe } from '../services/auditLog.js';
```

- [ ] **Step 2: Hook `POST /` (add staff), after line 61's insert, before `res.json({ status: 'ok' })` (line 62)**

```js
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'staff.add',
    summary: `Added staff ${outlet}/${name}`,
  });
```

(Not `await`ed — fire-and-forget, matches the fail-open design: the response must not wait on or fail because of the log write.)

- [ ] **Step 3: Hook `POST /reset-pin`, after the `rowCount` check (line 83), before `res.json({ status: 'ok' })` (line 84)**

```js
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'staff.reset_pin',
    summary: `Reset PIN for ${outlet}/${name}`,
  });
```

- [ ] **Step 4: Hook `DELETE /`, after the delete query (line 93), before `res.json({ status: 'ok' })` (line 94)**

```js
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'staff.delete',
    summary: `Removed staff ${outlet}/${name}`,
  });
```

- [ ] **Step 5: Verify via curl — all 3 actions, one throwaway staff record**

```bash
# Add
curl -s -X POST http://localhost:3000/staff-roster-manage -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -d '{"division":"retail","outlet":"OUTLET_TEST","name":"AUDIT TEST","pin":"1234","addedBy":"test"}'
# Reset PIN
curl -s -X POST http://localhost:3000/staff-roster-manage/reset-pin -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -d '{"division":"retail","outlet":"OUTLET_TEST","name":"AUDIT TEST","pin":"5678"}'
# Delete
curl -s -X DELETE http://localhost:3000/staff-roster-manage -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -d '{"division":"retail","outlet":"OUTLET_TEST","name":"AUDIT TEST"}'
```

Then:
```bash
node -e "import('./src/config/db.js').then(async ({pool}) => { const r = await pool.query(\"select action, summary from audit_log where actor_key=\$1 order by id desc limit 3\", ['OUTLET_TEST']); console.log(r.rows); await pool.end(); })"
```

Expected: 3 rows, `action` = `staff.delete`, `staff.reset_pin`, `staff.add` (most recent first), summaries mention `OUTLET_TEST/AUDIT TEST`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/staff.js
git commit -m "feat: audit-log staff add/reset-pin/delete"
```

---

### Task 4: `content.js` audit hooks (add, delete)

**Files:**
- Modify: `src/routes/content.js` (backend repo)

**Interfaces:**
- Consumes: `logAuditSafe` from `../services/auditLog.js` (Task 2).

- [ ] **Step 1: Add the import**

```js
import { logAuditSafe } from '../services/auditLog.js';
```

- [ ] **Step 2: Hook `POST /` (add content), after the insert (line 72), before `res.json({ status: 'ok', id: rows[0].id })` (line 73)**

```js
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'content.add',
    summary: `Added content "${title}" (${topic})`,
  });
```

- [ ] **Step 3: Hook `DELETE /:id`, after the delete query (line 77), before `res.json({ status: 'ok' })` (line 78)**

```js
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'content.delete',
    summary: `Deleted content id ${req.params.id}`,
  });
```

- [ ] **Step 4: Verify via curl**

```bash
curl -s -X POST http://localhost:3000/content -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" -d '{"topic":"AuditTest","category":"Test","title":"Audit Test Entry","body":"test body"}'
# note the returned id, then:
curl -s -X DELETE http://localhost:3000/content/<id> -H "Authorization: Bearer $SUPERVISOR_TOKEN"
```

```bash
node -e "import('./src/config/db.js').then(async ({pool}) => { const r = await pool.query(\"select action, summary from audit_log where action like 'content.%' order by id desc limit 2\"); console.log(r.rows); await pool.end(); })"
```

Expected: 2 rows, `content.delete` then `content.add`, summaries reference "Audit Test Entry" / the deleted id.

- [ ] **Step 5: Commit**

```bash
git add src/routes/content.js
git commit -m "feat: audit-log content add/delete"
```

---

### Task 5: `reports.js` audit hook (create/update)

**Files:**
- Modify: `src/routes/reports.js` (backend repo)

**Interfaces:**
- Consumes: `logAuditSafe` from `../services/auditLog.js` (Task 2).

- [ ] **Step 1: Add the import**

```js
import { logAuditSafe } from '../services/auditLog.js';
```

- [ ] **Step 2: Hook the "updated" path, after the update query (line 61), before `return res.json({ status: 'updated' })` (line 62)**

```js
    logAuditSafe({
      actorType: req.session.scopeType,
      actorKey: req.session.scopeKey,
      action: 'report.update',
      summary: `Updated report ${outlet}/${staffName} (${topic})`,
    });
```

- [ ] **Step 3: Hook the "created" path, after the insert query (line 69), before `res.json({ status: 'created' })` (line 70)**

```js
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'report.create',
    summary: `Filed report ${outlet}/${staffName} (${topic})`,
  });
```

- [ ] **Step 4: Verify via curl — both branches**

```bash
# Create
curl -s -X POST http://localhost:3000/reports -H "Authorization: Bearer $AREA_MANAGER_TOKEN" -H "Content-Type: application/json" -d '{"outlet":"<a real outlet in the area manager region>","staffName":"AUDIT TEST","topic":"AuditTestTopic","manager":"<area manager scopeKey>","skillLevel":"HIGH"}'
# Update (same outlet/staffName/topic, isEdit true, same manager)
curl -s -X POST http://localhost:3000/reports -H "Authorization: Bearer $AREA_MANAGER_TOKEN" -H "Content-Type: application/json" -d '{"outlet":"<same outlet>","staffName":"AUDIT TEST","topic":"AuditTestTopic","manager":"<same manager>","skillLevel":"MEDIUM","isEdit":true}'
```

```bash
node -e "import('./src/config/db.js').then(async ({pool}) => { const r = await pool.query(\"select action, summary from audit_log where action like 'report.%' order by id desc limit 2\"); console.log(r.rows); await pool.end(); })"
```

Expected: 2 rows, `report.update` then `report.create`, both mentioning `AUDIT TEST` / `AuditTestTopic`. Clean up the test report row after (`DELETE FROM reports WHERE staff_name='AUDIT TEST'` via a direct query or the master purge UI) since it's a throwaway.

- [ ] **Step 5: Commit**

```bash
git add src/routes/reports.js
git commit -m "feat: audit-log report create/update"
```

---

### Task 6: `auth.js` audit hooks (manager-register, rotate-master-pin, master-reset-supervisor-pin, master-login)

**Files:**
- Modify: `src/routes/auth.js` (backend repo)

**Interfaces:**
- Consumes: `logAuditSafe` from `../services/auditLog.js` (Task 2).

- [ ] **Step 1: Add the import**

```js
import { logAuditSafe } from '../services/auditLog.js';
```

- [ ] **Step 2: Hook `POST /manager-register`**

Find the success response in `manager-register` (after its credential upsert, before its final `res.json({...})` — read the current file around line 130-190 to find the exact success line, since line numbers shift after Step-2 edits in earlier tasks touched other files, not this one, so `auth.js` line numbers here are still accurate to the versions read during planning: the upsert is followed by `res.json({ status: 'ok' })`-shaped success). Insert immediately before that response:

```js
  logAuditSafe({
    actorType: role,
    actorKey: scopeKey,
    action: 'manager.register',
    summary: `Registered manager credential for ${role}/${scopeKey}`,
  });
```

(Use whatever the handler's actual local variable names are for role/scopeKey at that point — confirm by reading the handler body immediately before editing, since this call must reference real in-scope variables, not `req.session` — `manager-register` is unauthenticated by session, it authenticates via `masterPin` in the body instead, so `req.session` does not exist here.)

- [ ] **Step 3: Hook `POST /rotate-master-pin`, after the upsert (line 246), before `res.json({ status: 'ok' })` (line 247)**

```js
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'manager.rotate_pin',
    summary: `Rotated master PIN for role ${role}`,
  });
```

- [ ] **Step 4: Hook `POST /master-reset-supervisor-pin`, after the upsert (line 281), before `res.json({ status: 'ok' })` (line 282)**

```js
  logAuditSafe({
    actorType: 'master',
    actorKey: req.session.scopeKey,
    action: 'master.reset_supervisor_pin',
    summary: 'Reset Supervisor PIN',
  });
```

- [ ] **Step 5: Hook `POST /master-login`, success path only**

Read the handler body after line 299 (`const ok = match && password && await bcrypt.compare(...)`) to find where it issues the token on success (`issueMasterToken` call) and responds `{ authorized: true, token }`. Insert immediately before that success response, inside the `if (ok)` branch only (never on the failure branch):

```js
    logAuditSafe({
      actorType: 'master',
      actorKey: username,
      action: 'master.login',
      summary: `Master login: ${username}`,
    });
```

- [ ] **Step 6: Verify via curl — all 4**

```bash
# master-login (success)
curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<real master username>","password":"<real password>"}'
# rotate-master-pin
curl -s -X POST http://localhost:3000/auth/rotate-master-pin -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" -d '{"role":"outlet_manager","newMasterPin":"TEMP123456"}'
# master-reset-supervisor-pin (restore the real value after, per Subsystem B's documented incident precedent — check MEMORY.md for the current real Supervisor PIN before running this, and restore it immediately after this test)
curl -s -X POST http://localhost:3000/auth/master-reset-supervisor-pin -H "Authorization: Bearer $MASTER_TOKEN" -H "Content-Type: application/json" -d '{"newPin":"TEMPTEST123"}'
# manager-register (use a disposable outlet/role combo, or same outlet+role you're about to overwrite back — confirm with real value)
curl -s -X POST http://localhost:3000/auth/manager-register -H "Content-Type: application/json" -d '{"role":"outlet_manager","masterPin":"<current master pin for that role>","newPassword":"TempAuditTest123"}'
```

```bash
node -e "import('./src/config/db.js').then(async ({pool}) => { const r = await pool.query(\"select action, actor_type, summary from audit_log where action in ('master.login','manager.rotate_pin','master.reset_supervisor_pin','manager.register') order by id desc limit 4\"); console.log(r.rows); await pool.end(); })"
```

Expected: 4 rows, one per action. **Immediately restore any real credential changed during this test** (rotate-master-pin, master-reset-supervisor-pin, manager-register all mutate real, currently-in-use secrets — same caution as Subsystem B's documented live-PIN incident) — re-run the same endpoints with the original real values before moving on, and confirm the restored value logs in successfully.

- [ ] **Step 7: Commit**

```bash
git add src/routes/auth.js
git commit -m "feat: audit-log manager-register, rotate-master-pin, master-reset-supervisor-pin, master-login"
```

---

### Task 7: `maintenance.js` audit hook (toggle)

**Files:**
- Modify: `src/routes/maintenance.js` (backend repo)

**Interfaces:**
- Consumes: `logAuditSafe` from `../services/auditLog.js` (Task 2).

- [ ] **Step 1: Add the import and hook, after the upsert (line 27), before `res.json({ status: 'ok' })` (line 28)**

```js
import { logAuditSafe } from '../services/auditLog.js';
```

```js
  logAuditSafe({
    actorType: 'master',
    actorKey: req.session.scopeKey,
    action: 'maintenance.toggle',
    summary: `Maintenance ${enabled ? 'enabled' : 'disabled'}${message ? `: "${message}"` : ''}`,
  });
```

- [ ] **Step 2: Verify via curl**

```bash
curl -s -X POST http://localhost:3000/master/maintenance -H "Authorization: Bearer $MASTER_TOKEN" -H "Content-Type: application/json" -d '{"enabled":true,"message":"audit test"}'
curl -s -X POST http://localhost:3000/master/maintenance -H "Authorization: Bearer $MASTER_TOKEN" -H "Content-Type: application/json" -d '{"enabled":false,"message":""}'
```

```bash
node -e "import('./src/config/db.js').then(async ({pool}) => { const r = await pool.query(\"select action, summary from audit_log where action='maintenance.toggle' order by id desc limit 2\"); console.log(r.rows); await pool.end(); })"
```

Expected: 2 rows, "Maintenance disabled" then "Maintenance enabled: \"audit test\"" (most recent first). Confirm maintenance is left OFF after this test (don't leave the app blocked).

- [ ] **Step 3: Commit**

```bash
git add src/routes/maintenance.js
git commit -m "feat: audit-log maintenance toggle"
```

---

### Task 8: `GET /master/audit-log/search` route

**Files:**
- Create: `src/routes/auditLog.js` (backend repo)
- Modify: `src/index.js` (backend repo — add import + mount)

**Interfaces:**
- Consumes: `pool` from `../config/db.js`, `requireAuth`/`requireMaster` from `../middleware/auth.js` — same imports `masterPurge.js` already uses.
- Produces: `GET /master/audit-log/search` — later consumed by Task 9's frontend `api.searchAuditLog()`.

- [ ] **Step 1: Write `src/routes/auditLog.js`**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';

export const auditLogRouter = Router();

auditLogRouter.get('/search', requireAuth, requireMaster, async (req, res) => {
  const actorType = (req.query.actorType || '').toString().trim();
  const actorKey = (req.query.actorKey || '').toString().trim();
  const action = (req.query.action || '').toString().trim();
  const dateFrom = (req.query.dateFrom || '').toString().trim();
  const dateTo = (req.query.dateTo || '').toString().trim();

  const conditions = [];
  const params = [];
  if (actorType) { params.push(actorType); conditions.push(`actor_type = $${params.length}`); }
  if (actorKey) { params.push(`%${actorKey}%`); conditions.push(`actor_key ilike $${params.length}`); }
  if (action) { params.push(`%${action}%`); conditions.push(`action ilike $${params.length}`); }
  if (dateFrom) { params.push(dateFrom); conditions.push(`created_at >= $${params.length}`); }
  if (dateTo) { params.push(dateTo); conditions.push(`created_at <= $${params.length}`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { rows } = await pool.query(
    `select id, actor_type, actor_key, action, summary, affected_count, created_at from audit_log ${where} order by created_at desc limit 200`,
    params
  );
  res.json({
    entries: rows.map(r => ({
      id: r.id, actorType: r.actor_type, actorKey: r.actor_key, action: r.action,
      summary: r.summary, affectedCount: r.affected_count, createdAt: r.created_at,
    })),
  });
});
```

- [ ] **Step 2: Mount it in `src/index.js`**

Add import after line 13 (`import { maintenanceRouter } from './routes/maintenance.js';`):
```js
import { auditLogRouter } from './routes/auditLog.js';
```

Add mount after line 29 (`app.use('/master/purge', masterPurgeRouter);`):
```js
app.use('/master/audit-log', auditLogRouter);
```

- [ ] **Step 3: Verify via curl**

```bash
# No filters
curl -s http://localhost:3000/master/audit-log/search -H "Authorization: Bearer $MASTER_TOKEN" | jq '.entries | length'
# Filtered by action
curl -s http://localhost:3000/master/audit-log/search -H "Authorization: Bearer $MASTER_TOKEN" -G --data-urlencode "action=staff." | jq
# Filtered by actorType
curl -s http://localhost:3000/master/audit-log/search -H "Authorization: Bearer $MASTER_TOKEN" -G --data-urlencode "actorType=master" | jq
# No token
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/master/audit-log/search
```

Expected: unfiltered call returns entries from every prior task's tests (Tasks 2-7). `action=staff.` filter returns only `staff.add`/`staff.reset_pin`/`staff.delete` rows. `actorType=master` returns only master-actor rows. No-token call returns `401`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/auditLog.js src/index.js
git commit -m "feat: add GET /master/audit-log/search route"
```

---

### Task 9: Frontend `api/client.js` addition

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js`

**Interfaces:**
- Consumes: `request()` (existing, same file), `GET /master/audit-log/search` (Task 8).
- Produces: `api.searchAuditLog(params, masterToken)` — consumed by Task 11's `MasterAuditLog.vue`.

- [ ] **Step 1: Add the method**

After the last `masterSearchContent`/`masterDeleteContent` pair (matching the existing `masterSearch*` naming pattern, before the closing `getMaintenanceStatus`/`setMaintenanceStatus` lines at the end of the `api` object):

```js
  searchAuditLog: (params, masterToken) =>
    request(`/master/audit-log/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build` (from `lautan-academy-frontend/`)
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/client.js
git commit -m "feat: add searchAuditLog to api client"
```

---

### Task 10: i18n keys — `masterPanel.auditLogs.*`

**Files:**
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Produces: translation keys consumed by Task 11's `MasterAuditLog.vue` via `t('masterPanel.auditLogs.*')`.

- [ ] **Step 1: Add the English keys**

In `en.json`, inside the `masterPanel` object, add a new `auditLogs` sibling to `dataPurge` (near line 550, following the exact same key set `pinReset`/`dataPurge` already use for back/loading/search/error/empty-state patterns):

```json
    "auditLogs": {
      "title": "Audit Log",
      "back": "Back",
      "filterActorType": "Actor Type",
      "filterActorTypeAll": "All",
      "filterActorKey": "Actor",
      "filterActorKeyPlaceholder": "e.g. OUTLET05",
      "filterAction": "Action",
      "filterActionPlaceholder": "e.g. staff.add",
      "filterDateFrom": "From",
      "filterDateTo": "To",
      "search": "Search",
      "searching": "Searching...",
      "errorSearchFailed": "Search failed.",
      "noResults": "No matching audit log entries.",
      "colTime": "Time",
      "colActor": "Actor",
      "colAction": "Action",
      "colSummary": "Summary",
      "colCount": "Count"
    }
```

- [ ] **Step 2: Add the matching Bahasa Malaysia keys**

In `ms.json`, at the same location:

```json
    "auditLogs": {
      "title": "Log Audit",
      "back": "Kembali",
      "filterActorType": "Jenis Pelaku",
      "filterActorTypeAll": "Semua",
      "filterActorKey": "Pelaku",
      "filterActorKeyPlaceholder": "cth. OUTLET05",
      "filterAction": "Tindakan",
      "filterActionPlaceholder": "cth. staff.add",
      "filterDateFrom": "Dari",
      "filterDateTo": "Hingga",
      "search": "Cari",
      "searching": "Mencari...",
      "errorSearchFailed": "Carian gagal.",
      "noResults": "Tiada rekod log audit yang sepadan.",
      "colTime": "Masa",
      "colActor": "Pelaku",
      "colAction": "Tindakan",
      "colSummary": "Ringkasan",
      "colCount": "Bilangan"
    }
```

- [ ] **Step 3: Verify key parity**

Run: `npm run build` (from `lautan-academy-frontend/`)
Expected: clean build (a malformed JSON would fail the build immediately).

Run a quick key-count check matching the pattern prior subsystems used:
```bash
node -e "const en=require('./src/i18n/locales/en.json'); const ms=require('./src/i18n/locales/ms.json'); const flat=o=>Object.keys(o).reduce((a,k)=>{if(typeof o[k]==='object')Object.assign(a,Object.fromEntries(Object.keys(flat(o[k])).map(kk=>[k+'.'+kk,1])));else a[k]=1;return a},{}); const e=flat(en),m=flat(ms); console.log('en-only:', Object.keys(e).filter(k=>!m[k])); console.log('ms-only:', Object.keys(m).filter(k=>!e[k]));"
```
Expected: both arrays empty (no keys missing either direction).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add EN/MS strings for Audit Logs tab"
```

---

### Task 11: `MasterAuditLog.vue` component

**Files:**
- Create: `lautan-academy-frontend/src/components/MasterAuditLog.vue`

**Interfaces:**
- Consumes: `api.searchAuditLog` (Task 9), `masterPanel.auditLogs.*` i18n keys (Task 10), `useMasterAuthStore` (existing, same shape `PurgeStaffPanel.vue` uses).
- Produces: `MasterAuditLog.vue` default export — a component taking no props, emitting `close` — consumed by Task 12's `MasterPanel.vue`.

- [ ] **Step 1: Write the component**

Mirrors `PurgeStaffPanel.vue`'s search-and-render shape (read-only, no selection/delete):

```vue
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const ACTOR_TYPES = ['master', 'outlet_manager', 'warehouse_manager', 'area_manager', 'supervisor']

const actorType = ref('')
const actorKey = ref('')
const action = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const entries = ref([])
const searching = ref(false)
const searchError = ref('')
const searched = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  try {
    const params = {}
    if (actorType.value) params.actorType = actorType.value
    if (actorKey.value.trim()) params.actorKey = actorKey.value.trim()
    if (action.value.trim()) params.action = action.value.trim()
    if (dateFrom.value) params.dateFrom = dateFrom.value
    if (dateTo.value) params.dateTo = dateTo.value
    const data = await api.searchAuditLog(params, masterAuth.token)
    entries.value = data.entries || []
    searched.value = true
  } catch (err) {
    searchError.value = err.message || t('masterPanel.auditLogs.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

search()
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.auditLogs.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.auditLogs.title') }}</h3>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <select v-model="actorType" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.auditLogs.filterActorTypeAll') }}</option>
        <option v-for="opt in ACTOR_TYPES" :key="opt" :value="opt">{{ opt }}</option>
      </select>
      <input v-model="actorKey" type="text" :placeholder="t('masterPanel.auditLogs.filterActorKeyPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="action" type="text" :placeholder="t('masterPanel.auditLogs.filterActionPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="dateFrom" type="date" class="border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="dateTo" type="date" class="border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.auditLogs.searching') : t('masterPanel.auditLogs.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="entries.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[40rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2">{{ t('masterPanel.auditLogs.colTime') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colActor') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colAction') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colSummary') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colCount') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id" class="border-b border-seafoam last:border-0">
            <td class="p-2 text-slate text-xs whitespace-nowrap">{{ new Date(e.createdAt).toLocaleString() }}</td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ e.actorType }}/{{ e.actorKey }}</td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ e.action }}</td>
            <td class="p-2 text-ink text-xs">{{ e.summary }}</td>
            <td class="p-2 text-slate text-xs">{{ e.affectedCount ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="searched && !searching" class="text-slate text-xs">{{ t('masterPanel.auditLogs.noResults') }}</p>
  </div>
</template>
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build` (from `lautan-academy-frontend/`)
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MasterAuditLog.vue
git commit -m "feat: add MasterAuditLog.vue component"
```

---

### Task 12: Wire `MasterAuditLog.vue` into `MasterPanel.vue`

**Files:**
- Modify: `lautan-academy-frontend/src/components/MasterPanel.vue`

**Interfaces:**
- Consumes: `MasterAuditLog.vue` (Task 11).

- [ ] **Step 1: Add the import (after line 6, `import MasterDataPurge from './MasterDataPurge.vue'`)**

```js
import MasterAuditLog from './MasterAuditLog.vue'
```

- [ ] **Step 2: Add `'auditLogs'` to `ENABLED_TABS` (line 17)**

Change:
```js
const ENABLED_TABS = ['pinReset', 'dataPurge', 'maintenanceMode']
```
to:
```js
const ENABLED_TABS = ['pinReset', 'dataPurge', 'maintenanceMode', 'auditLogs']
```

- [ ] **Step 3: Widen the drawer for the audit log tab too (line 30), and render the component (after line 38's `MasterMaintenance` branch)**

Change:
```vue
<div class="w-full h-full bg-white shadow-lg flex flex-col" :class="activeTab === 'dataPurge' ? 'max-w-3xl' : 'max-w-sm'">
```
to:
```vue
<div class="w-full h-full bg-white shadow-lg flex flex-col" :class="['dataPurge', 'auditLogs'].includes(activeTab) ? 'max-w-3xl' : 'max-w-sm'">
```

Add after the `MasterMaintenance` line:
```vue
        <MasterAuditLog v-else-if="activeTab === 'auditLogs'" @close="activeTab = null" />
```

- [ ] **Step 4: Verify with a build, then live browser click-through**

Run: `npm run build` (from `lautan-academy-frontend/`)
Expected: clean build.

Then manually: run `npm run dev` on both frontend and backend, log in as Master, open Master Panel, click "Audit Logs" — confirm it's no longer "Coming Soon" and opens the new search UI, drawer widens to match Data Purge's width, search with no filters shows the entries created across Tasks 2-8's curl tests, filter by actor type/action/date narrows correctly, Back button returns to the tab list, switch language to MS and confirm the tab title/labels translate. Also spot check that unrelated tabs (`overrides`, `backupExport`, `sessions`, `impersonation`) still show "Coming Soon" and are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/components/MasterPanel.vue
git commit -m "feat: wire MasterAuditLog into Master Panel's auditLogs tab"
```

---

## Self-Review Notes

- **Spec coverage:** table+migration (Task 1), helper+fail-open/fail-closed split (Task 2), all 11 non-purge call sites across 5 files (Tasks 3-7), search route (Task 8), frontend api/i18n/component/wiring (Tasks 9-12) — every section of the spec has a task.
- **`master.login` scope:** spec says success-only; Task 6 Step 5 explicitly places the hook inside the `if (ok)` branch, not on the failure path.
- **Purge fail-closed vs standalone fail-open:** Task 2 defines both `logAudit` (throws, used by purge inside its existing transaction) and `logAuditSafe` (catches, used by every standalone route in Tasks 3-7) — matches the spec's explicit distinction, not accidentally uniform.
- **Sensitive-credential test caution in Task 6:** flagged explicitly to restore real values after testing rotate-master-pin/master-reset-supervisor-pin/manager-register, referencing the same incident class Subsystem B already hit once.
