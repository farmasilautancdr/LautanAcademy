# Master Subsystem C — Test-Data Purge / Hard Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Master a UI to search and permanently delete test data across 4 entity types (staff accounts, quiz attempt records, manager/outlet accounts, reports/content), with a type-to-confirm gate and a minimal delete-audit trail.

**Architecture:** One new backend file (`routes/masterPurge.js`, mounted at `/master/purge`) holds all search+delete endpoints and writes to a new `master_delete_log` table inside the same transaction as each delete. One new frontend shell (`MasterDataPurge.vue`) with 4 sub-tab panel components, each doing search → multi-select → shared type-to-confirm modal → delete.

**Tech Stack:** Node.js/Express/`pg` (backend), Vue 3 `<script setup>`/Pinia/`vue-i18n` (frontend). No new dependencies.

## Global Constraints

- Backend: `requireAuth, requireMaster` on every new route — no other gate exists or is needed (matches Subsystem B).
- `manager_pins` is never touched by this subsystem — only `manager_credentials` rows are deletable. Server-side allow-list: `['outlet_manager', 'warehouse_manager', 'area_manager']`.
- Every delete writes exactly one row to `master_delete_log`, inside the same DB transaction as the delete itself — if the transaction rolls back, no log row exists.
- Legacy quiz-attempt rows (`attempt_id IS NULL`) delete the results/ai_results row only; their `wrong_answers`/`ai_wrong_answers` are left in place, never matched by topic-only.
- No test framework exists in either repo (confirmed: backend `package.json` has no test runner; frontend has no vitest/jest). Verification throughout is `npm run build` (frontend) + curl against a running dev server (backend) + manual browser click-through — matching every prior subsystem's convention, not a plan gap.
- Bilingual EN/MS for every user-facing string, flat-namespace-per-view convention under `masterPanel.dataPurge.*` in `src/i18n/locales/{en,ms}.json`.
- All SQL uses parameterized queries (`$1`, `$2`, ...) — table names are only ever selected from a hardcoded ternary (`'ai_results'` vs `'results'`, etc.), never interpolated from raw request input.
- Backend repo: `C:\Users\Hafiz\projects\lautan-academy-backend`. Frontend repo: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend`. Separate git repos — commit each independently.

---

## Task 1: `master_delete_log` table migration

**Files:**
- Create: `lautan-academy-backend/scripts/migrate-add-master-delete-log.js`
- Modify: `lautan-academy-backend/sql/schema.sql` (append table definition, keeps this file the canonical living schema doc, matching how `manager_credentials`/`attempt_id` were both added here alongside their migration scripts)

**Interfaces:**
- Produces: table `master_delete_log(id bigserial pk, master_username text, entity_type text, summary text, deleted_count int, created_at timestamptz)`. Task 2 depends on this table existing.

- [ ] **Step 1: Write the migration script**

```js
// One-off: adds master_delete_log, the interim audit trail for Master
// Subsystem C (test-data purge/hard delete) until Subsystem E (full audit
// logs) exists — see docs/superpowers/specs/2026-08-11-master-subsystem-c-design.md.
// Safe to re-run.
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`
    create table if not exists master_delete_log (
      id bigserial primary key,
      master_username text not null,
      entity_type text not null,
      summary text not null,
      deleted_count int not null,
      created_at timestamptz not null default now()
    )
  `);
  console.log('Migration complete: master_delete_log table created.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the migration against the dev DB**

Run (from `lautan-academy-backend/`): `node scripts/migrate-add-master-delete-log.js`
Expected: prints `Migration complete: master_delete_log table created.`, exits 0.

- [ ] **Step 3: Verify idempotency (safe to re-run)**

Run the same command again.
Expected: same success output, no error (proves `create table if not exists` guards a second run, matching every other migration script in this repo).

- [ ] **Step 4: Append the table to `sql/schema.sql`**

Add after the `rate_limits` table definition (before the `create index` block at the bottom):

```sql
-- Interim audit trail for Master Subsystem C (test-data purge/hard delete)
-- until Subsystem E (full audit logs) exists. One row per delete call,
-- written inside the same transaction as the delete itself.
create table if not exists master_delete_log (
  id bigserial primary key,
  master_username text not null,
  entity_type text not null,       -- 'staff' | 'quiz_attempt' | 'manager_account' | 'report' | 'content'
  summary text not null,
  deleted_count int not null,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 5: Verify the table exists with the right columns**

Run: `node -e "import('./src/config/db.js').then(async ({ pool }) => { const r = await pool.query(\"select column_name, data_type from information_schema.columns where table_name = 'master_delete_log' order by ordinal_position\"); console.log(r.rows); await pool.end(); })"`
Expected: prints 6 rows (`id`/bigint, `master_username`/text, `entity_type`/text, `summary`/text, `deleted_count`/integer, `created_at`/timestamp with time zone).

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-add-master-delete-log.js sql/schema.sql
git commit -m "feat: add master_delete_log table for Subsystem C's interim audit trail"
```

---

## Task 2: `routes/masterPurge.js` — file, transaction helper, Staff accounts search+delete

**Files:**
- Create: `lautan-academy-backend/src/routes/masterPurge.js`
- Modify: `lautan-academy-backend/src/index.js` (mount router)

**Interfaces:**
- Consumes: `pool` from `../config/db.js`; `requireAuth, requireMaster` from `../middleware/auth.js`; `master_delete_log` table from Task 1.
- Produces: `withTransaction(fn)` and `logDelete(client, masterUsername, entityType, summary, deletedCount)` — internal helpers reused by Tasks 3-5 in this same file. Routes `GET /master/purge/staff/search`, `POST /master/purge/staff/delete`. Response shapes:
  - Search: `{ staff: [{ id, division, outlet, name, idNote, createdAt, relatedCounts: { results, wrongAnswers, aiResults, aiWrongAnswers, reports } }] }`
  - Delete: `{ status: 'ok', deletedCount }` or `{ status: 'error', error }`

- [ ] **Step 1: Create the router file with transaction helpers and Staff endpoints**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';

export const masterPurgeRouter = Router();

// Every delete route in this file runs its cascade + its master_delete_log
// write inside one transaction, so a mid-cascade failure can't leave a
// partial delete with no trace of what happened. See
// docs/superpowers/specs/2026-08-11-master-subsystem-c-design.md.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function logDelete(client, masterUsername, entityType, summary, deletedCount) {
  await client.query(
    'insert into master_delete_log (master_username, entity_type, summary, deleted_count) values ($1,$2,$3,$4)',
    [masterUsername, entityType, summary, deletedCount]
  );
}

// staff_roster has no FK to results/wrong_answers/ai_results/ai_wrong_answers/
// reports — every query in this codebase matches those by outlet+name text,
// so this cascade does the same.
masterPurgeRouter.get('/staff/search', requireAuth, requireMaster, async (req, res) => {
  const outlet = (req.query.outlet || '').toString().trim().toUpperCase();
  const name = (req.query.name || '').toString().trim().toUpperCase();

  const conditions = [];
  const params = [];
  if (outlet) { params.push(outlet); conditions.push(`outlet = $${params.length}`); }
  if (name) { params.push(`%${name}%`); conditions.push(`name like $${params.length}`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { rows } = await pool.query(
    `select id, division, outlet, name, id_note, created_at from staff_roster ${where} order by outlet, name limit 200`,
    params
  );

  const staff = await Promise.all(rows.map(async (s) => {
    const { rows: countRows } = await pool.query(
      `select
        (select count(*) from results where outlet=$1 and name=$2) as results,
        (select count(*) from wrong_answers where outlet=$1 and staff_name=$2) as wrong_answers,
        (select count(*) from ai_results where outlet=$1 and name=$2) as ai_results,
        (select count(*) from ai_wrong_answers where outlet=$1 and staff_name=$2) as ai_wrong_answers,
        (select count(*) from reports where outlet=$1 and staff_name=$2) as reports`,
      [s.outlet, s.name]
    );
    const c = countRows[0];
    return {
      id: s.id, division: s.division, outlet: s.outlet, name: s.name, idNote: s.id_note, createdAt: s.created_at,
      relatedCounts: {
        results: Number(c.results), wrongAnswers: Number(c.wrong_answers),
        aiResults: Number(c.ai_results), aiWrongAnswers: Number(c.ai_wrong_answers), reports: Number(c.reports),
      },
    };
  }));

  res.json({ staff });
});

masterPurgeRouter.post('/staff/delete', requireAuth, requireMaster, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ status: 'error', error: 'No staff selected.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: staffRows } = await client.query(
        'select id, outlet, name from staff_roster where id = ANY($1::bigint[])',
        [ids]
      );
      if (!staffRows.length) throw new Error('No matching staff accounts found.');

      let totalDeleted = 0;
      const names = [];
      for (const s of staffRows) {
        const r1 = await client.query('delete from results where outlet=$1 and name=$2', [s.outlet, s.name]);
        const r2 = await client.query('delete from wrong_answers where outlet=$1 and staff_name=$2', [s.outlet, s.name]);
        const r3 = await client.query('delete from ai_results where outlet=$1 and name=$2', [s.outlet, s.name]);
        const r4 = await client.query('delete from ai_wrong_answers where outlet=$1 and staff_name=$2', [s.outlet, s.name]);
        const r5 = await client.query('delete from reports where outlet=$1 and staff_name=$2', [s.outlet, s.name]);
        const r6 = await client.query('delete from staff_roster where id=$1', [s.id]);
        totalDeleted += r1.rowCount + r2.rowCount + r3.rowCount + r4.rowCount + r5.rowCount + r6.rowCount;
        names.push(`${s.outlet}/${s.name}`);
      }

      const summary = `Deleted ${staffRows.length} staff account(s): ${names.join(', ')}`;
      await logDelete(client, req.session.scopeKey, 'staff', summary, totalDeleted);
      return { deletedCount: totalDeleted };
    });

    res.json({ status: 'ok', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message || 'Delete failed.' });
  }
});
```

- [ ] **Step 2: Mount the router in `src/index.js`**

Add the import near the other route imports and the mount line near the other `app.use(...)` calls:

```js
import { masterPurgeRouter } from './routes/masterPurge.js';
```
```js
app.use('/master/purge', masterPurgeRouter);
```

- [ ] **Step 3: Start the dev server**

Run (from `lautan-academy-backend/`): `npm run dev` (leave running in background for the curl steps below).

- [ ] **Step 4: Get a master token**

```bash
curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<your master username>","password":"<your master password>"}'
```
Expected: `{"authorized":true,"token":"..."}`. Save the token as `$TOKEN` for the following steps.

- [ ] **Step 5: Seed a throwaway staff account with related rows**

```bash
curl -s -X POST http://localhost:3000/staff-roster-manage -H "Content-Type: application/json" -H "Authorization: Bearer <an outlet manager token for outlet ZZTEST>" -d '{"division":"retail","outlet":"ZZTEST","name":"PURGETEST STAFF","pin":"1234","addedBy":"test"}'
```
If no outlet manager exists for a throwaway outlet, insert directly for speed instead — run once:
```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { await pool.query(\"insert into staff_roster (division, outlet, name, pin_hash) values ('retail','ZZTEST','PURGETEST STAFF','x')\"); await pool.query(\"insert into results (outlet, name, topic, score, percentage) values ('ZZTEST','PURGETEST STAFF','Topic',1,'100%')\"); await pool.query(\"insert into reports (outlet, staff_name, manager, topic) values ('ZZTEST','PURGETEST STAFF','Test Mgr','Topic')\"); await pool.end(); })"
```

- [ ] **Step 6: Search finds the seeded staff with correct related counts**

```bash
curl -s "http://localhost:3000/master/purge/staff/search?outlet=ZZTEST" -H "Authorization: Bearer $TOKEN"
```
Expected: one row, `name: "PURGETEST STAFF"`, `relatedCounts.results: 1`, `relatedCounts.reports: 1`, others `0`.

- [ ] **Step 7: Delete cascades correctly**

```bash
curl -s -X POST http://localhost:3000/master/purge/staff/delete -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"ids":["<the id from step 6>"]}'
```
Expected: `{"status":"ok","deletedCount":3}` (1 staff_roster + 1 results + 1 reports).

- [ ] **Step 8: Verify everything is gone and the log row exists**

```bash
curl -s "http://localhost:3000/master/purge/staff/search?outlet=ZZTEST" -H "Authorization: Bearer $TOKEN"
```
Expected: `{"staff":[]}`.
```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { const r = await pool.query(\"select * from master_delete_log where entity_type='staff' order by id desc limit 1\"); console.log(r.rows); await pool.end(); })"
```
Expected: one row with `deleted_count: 3` and a `summary` mentioning `ZZTEST/PURGETEST STAFF`.

- [ ] **Step 9: Verify non-master token is rejected**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/master/purge/staff/search?outlet=ZZTEST" -H "Authorization: Bearer <a regular staff or manager token>"
```
Expected: `403`.

- [ ] **Step 10: Commit**

```bash
git add src/routes/masterPurge.js src/index.js
git commit -m "feat: add Master staff-account purge search+delete endpoints"
```

---

## Task 3: Quiz attempt records search+delete

**Files:**
- Modify: `lautan-academy-backend/src/routes/masterPurge.js`

**Interfaces:**
- Consumes: `withTransaction`, `logDelete` from Task 2 (same file, no import needed).
- Produces: `GET /master/purge/quiz-attempts/search`, `POST /master/purge/quiz-attempts/delete`. Response shapes:
  - Search: `{ attempts: [{ id, attemptId, outlet, name, topic, score, percentage, createdAt, hasAttemptId }] }`
  - Delete: `{ status: 'ok', deletedCount }` or `{ status: 'error', error }`

- [ ] **Step 1: Add the two routes to `routes/masterPurge.js`** (append after the staff routes)

```js
masterPurgeRouter.get('/quiz-attempts/search', requireAuth, requireMaster, async (req, res) => {
  const type = req.query.type === 'ai' ? 'ai' : 'standard';
  const table = type === 'ai' ? 'ai_results' : 'results';
  const outlet = (req.query.outlet || '').toString().trim().toUpperCase();
  const name = (req.query.name || '').toString().trim().toUpperCase();
  const topic = (req.query.topic || '').toString().trim();
  const dateFrom = (req.query.dateFrom || '').toString().trim();
  const dateTo = (req.query.dateTo || '').toString().trim();

  const conditions = [];
  const params = [];
  if (outlet) { params.push(outlet); conditions.push(`outlet = $${params.length}`); }
  if (name) { params.push(`%${name}%`); conditions.push(`name like $${params.length}`); }
  if (topic) { params.push(`%${topic}%`); conditions.push(`topic like $${params.length}`); }
  if (dateFrom) { params.push(dateFrom); conditions.push(`created_at >= $${params.length}`); }
  if (dateTo) { params.push(dateTo); conditions.push(`created_at <= $${params.length}`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { rows } = await pool.query(
    `select id, attempt_id, outlet, name, topic, score, percentage, created_at from ${table} ${where} order by created_at desc limit 200`,
    params
  );
  res.json({
    attempts: rows.map(r => ({
      id: r.id, attemptId: r.attempt_id, outlet: r.outlet, name: r.name, topic: r.topic,
      score: r.score, percentage: r.percentage, createdAt: r.created_at, hasAttemptId: !!r.attempt_id,
    })),
  });
});

masterPurgeRouter.post('/quiz-attempts/delete', requireAuth, requireMaster, async (req, res) => {
  const type = req.body.type === 'ai' ? 'ai' : 'standard';
  const resultsTable = type === 'ai' ? 'ai_results' : 'results';
  const wrongTable = type === 'ai' ? 'ai_wrong_answers' : 'wrong_answers';
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ status: 'error', error: 'No attempts selected.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: attemptRows } = await client.query(
        `select id, attempt_id, outlet, name, topic from ${resultsTable} where id = ANY($1::bigint[])`,
        [ids]
      );
      if (!attemptRows.length) throw new Error('No matching attempts found.');

      let totalDeleted = 0;
      let legacyCount = 0;
      for (const a of attemptRows) {
        if (a.attempt_id) {
          const rw = await client.query(`delete from ${wrongTable} where attempt_id=$1`, [a.attempt_id]);
          totalDeleted += rw.rowCount;
        } else {
          legacyCount += 1;
        }
        const rr = await client.query(`delete from ${resultsTable} where id=$1`, [a.id]);
        totalDeleted += rr.rowCount;
      }

      const summary = `Deleted ${attemptRows.length} ${type} quiz attempt(s)` + (legacyCount ? ` (${legacyCount} legacy, wrong answers left in place)` : '');
      await logDelete(client, req.session.scopeKey, 'quiz_attempt', summary, totalDeleted);
      return { deletedCount: totalDeleted };
    });

    res.json({ status: 'ok', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message || 'Delete failed.' });
  }
});
```

- [ ] **Step 2: Seed a real attempt (with attempt_id) and a legacy attempt (without)**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { await pool.query(\"insert into results (attempt_id, outlet, name, topic, score, percentage) values ('purgetest-1','ZZTEST','PURGETEST STAFF','Topic','1/1','100%')\"); await pool.query(\"insert into wrong_answers (attempt_id, outlet, staff_name, topic, question, chosen, correct) values ('purgetest-1','ZZTEST','PURGETEST STAFF','Topic','Q?','A','B')\"); await pool.query(\"insert into results (outlet, name, topic, score, percentage) values ('ZZTEST','PURGETEST STAFF','Topic','1/1','100%')\"); await pool.end(); })"
```

- [ ] **Step 3: Search returns both, with correct `hasAttemptId`**

```bash
curl -s "http://localhost:3000/master/purge/quiz-attempts/search?type=standard&outlet=ZZTEST" -H "Authorization: Bearer $TOKEN"
```
Expected: 2 rows, one `hasAttemptId: true` (attemptId `"purgetest-1"`), one `hasAttemptId: false`.

- [ ] **Step 4: Delete both in one call, confirm cascade + legacy skip**

```bash
curl -s -X POST http://localhost:3000/master/purge/quiz-attempts/delete -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"type":"standard","ids":["<id1>","<id2>"]}'
```
Expected: `{"status":"ok","deletedCount":3}` (2 results rows + 1 wrong_answers row from the attempt_id-linked one).

- [ ] **Step 5: Verify wrong_answers for the attempt_id row is gone, results rows gone**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { const r = await pool.query(\"select count(*) from wrong_answers where attempt_id='purgetest-1'\"); console.log(r.rows); const r2 = await pool.query(\"select count(*) from results where outlet='ZZTEST'\"); console.log(r2.rows); await pool.end(); })"
```
Expected: both counts `0`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/masterPurge.js
git commit -m "feat: add Master quiz-attempt purge search+delete endpoints"
```

---

## Task 4: Manager/outlet account search+delete

**Files:**
- Modify: `lautan-academy-backend/src/routes/masterPurge.js`

**Interfaces:**
- Consumes: `withTransaction`, `logDelete` from Task 2.
- Produces: `GET /master/purge/manager-accounts/search`, `POST /master/purge/manager-accounts/delete`. Response shapes:
  - Search: `{ accounts: [{ id, role, scopeKey, createdAt }] }`
  - Delete: `{ status: 'ok', deletedCount }` or `{ status: 'error', error }`

- [ ] **Step 1: Add the two routes** (append after the quiz-attempts routes)

```js
// manager_pins (the shared role-level PIN) is deliberately excluded — see
// docs/superpowers/specs/2026-08-11-master-subsystem-c-design.md. Only
// manager_credentials (per-outlet/area personal accounts) are deletable,
// and only for these 3 roles (supervisor/resources have no per-account rows).
const MANAGER_PURGE_ROLES = ['outlet_manager', 'warehouse_manager', 'area_manager'];

masterPurgeRouter.get('/manager-accounts/search', requireAuth, requireMaster, async (req, res) => {
  const role = (req.query.role || '').toString().trim();
  const scopeKey = (req.query.scopeKey || '').toString().trim().toUpperCase();

  const conditions = [];
  const params = [];
  if (role && MANAGER_PURGE_ROLES.includes(role)) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  } else {
    params.push(MANAGER_PURGE_ROLES);
    conditions.push(`role = ANY($${params.length})`);
  }
  if (scopeKey) { params.push(`%${scopeKey}%`); conditions.push(`scope_key like $${params.length}`); }
  const where = `where ${conditions.join(' and ')}`;

  const { rows } = await pool.query(
    `select id, role, scope_key, created_at from manager_credentials ${where} order by role, scope_key`,
    params
  );
  res.json({ accounts: rows.map(r => ({ id: r.id, role: r.role, scopeKey: r.scope_key, createdAt: r.created_at })) });
});

masterPurgeRouter.post('/manager-accounts/delete', requireAuth, requireMaster, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ status: 'error', error: 'No accounts selected.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'select id, role, scope_key from manager_credentials where id = ANY($1::bigint[]) and role = ANY($2)',
        [ids, MANAGER_PURGE_ROLES]
      );
      if (!rows.length) throw new Error('No matching manager accounts found.');

      const { rowCount } = await client.query('delete from manager_credentials where id = ANY($1::bigint[])', [rows.map(r => r.id)]);
      const summary = `Deleted ${rowCount} manager account(s): ${rows.map(r => `${r.role}/${r.scope_key}`).join(', ')}`;
      await logDelete(client, req.session.scopeKey, 'manager_account', summary, rowCount);
      return { deletedCount: rowCount };
    });

    res.json({ status: 'ok', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message || 'Delete failed.' });
  }
});
```

- [ ] **Step 2: Seed a throwaway manager account**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { await pool.query(\"insert into manager_credentials (role, scope_key, password_hash) values ('outlet_manager','ZZTEST','x') on conflict (role, scope_key) do nothing\"); await pool.end(); })"
```

- [ ] **Step 3: Search finds it, scoped correctly**

```bash
curl -s "http://localhost:3000/master/purge/manager-accounts/search?role=outlet_manager&scopeKey=ZZTEST" -H "Authorization: Bearer $TOKEN"
```
Expected: one row, `role: "outlet_manager"`, `scopeKey: "ZZTEST"`.

- [ ] **Step 4: Delete it, verify gone**

```bash
curl -s -X POST http://localhost:3000/master/purge/manager-accounts/delete -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"ids":["<id from step 3>"]}'
```
Expected: `{"status":"ok","deletedCount":1}`. Re-run the search from Step 3, expect `{"accounts":[]}`.

- [ ] **Step 5: Confirm `manager_pins` has no equivalent route (spec exclusion holds)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/master/purge/manager-pins/search" -H "Authorization: Bearer $TOKEN"
```
Expected: `404` (no such route exists — proves the exclusion wasn't accidentally implemented).

- [ ] **Step 6: Commit**

```bash
git add src/routes/masterPurge.js
git commit -m "feat: add Master manager-account purge search+delete endpoints"
```

---

## Task 5: Reports + Content search+delete

**Files:**
- Modify: `lautan-academy-backend/src/routes/masterPurge.js`

**Interfaces:**
- Consumes: `withTransaction`, `logDelete` from Task 2.
- Produces: `GET /master/purge/reports/search`, `POST /master/purge/reports/delete`, `GET /master/purge/content/search`, `POST /master/purge/content/delete`. Response shapes:
  - Reports search: `{ reports: [{ id, outlet, staffName, manager, topic, createdAt }] }`
  - Content search: `{ content: [{ id, topic, category, title, createdAt }] }`
  - Both deletes: `{ status: 'ok', deletedCount }` or `{ status: 'error', error }`

- [ ] **Step 1: Add all four routes** (append after the manager-accounts routes)

```js
masterPurgeRouter.get('/reports/search', requireAuth, requireMaster, async (req, res) => {
  const outlet = (req.query.outlet || '').toString().trim().toUpperCase();
  const staffName = (req.query.staffName || '').toString().trim().toUpperCase();
  const topic = (req.query.topic || '').toString().trim();

  const conditions = [];
  const params = [];
  if (outlet) { params.push(outlet); conditions.push(`outlet = $${params.length}`); }
  if (staffName) { params.push(`%${staffName}%`); conditions.push(`staff_name like $${params.length}`); }
  if (topic) { params.push(`%${topic}%`); conditions.push(`topic like $${params.length}`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { rows } = await pool.query(
    `select id, outlet, staff_name, manager, topic, created_at from reports ${where} order by created_at desc limit 200`,
    params
  );
  res.json({ reports: rows.map(r => ({ id: r.id, outlet: r.outlet, staffName: r.staff_name, manager: r.manager, topic: r.topic, createdAt: r.created_at })) });
});

masterPurgeRouter.post('/reports/delete', requireAuth, requireMaster, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ status: 'error', error: 'No reports selected.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rowCount } = await client.query('delete from reports where id = ANY($1::bigint[])', [ids]);
      if (!rowCount) throw new Error('No matching reports found.');
      await logDelete(client, req.session.scopeKey, 'report', `Deleted ${rowCount} report(s)`, rowCount);
      return { deletedCount: rowCount };
    });
    res.json({ status: 'ok', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message || 'Delete failed.' });
  }
});

masterPurgeRouter.get('/content/search', requireAuth, requireMaster, async (req, res) => {
  const category = (req.query.category || '').toString().trim();
  const topic = (req.query.topic || '').toString().trim();

  const conditions = [];
  const params = [];
  if (category) { params.push(`%${category}%`); conditions.push(`category like $${params.length}`); }
  if (topic) { params.push(`%${topic}%`); conditions.push(`topic like $${params.length}`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { rows } = await pool.query(
    `select id, topic, category, title, created_at from content ${where} order by topic, title limit 200`,
    params
  );
  res.json({ content: rows.map(r => ({ id: r.id, topic: r.topic, category: r.category, title: r.title, createdAt: r.created_at })) });
});

masterPurgeRouter.post('/content/delete', requireAuth, requireMaster, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ status: 'error', error: 'No content entries selected.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rowCount } = await client.query('delete from content where id = ANY($1::bigint[])', [ids]);
      if (!rowCount) throw new Error('No matching content entries found.');
      await logDelete(client, req.session.scopeKey, 'content', `Deleted ${rowCount} content entry(ies)`, rowCount);
      return { deletedCount: rowCount };
    });
    res.json({ status: 'ok', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message || 'Delete failed.' });
  }
});
```

- [ ] **Step 2: Seed a throwaway report and content entry**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { await pool.query(\"insert into reports (outlet, staff_name, manager, topic) values ('ZZTEST','PURGETEST STAFF','Test Mgr','PurgeTestTopic') on conflict (outlet, staff_name, topic) do nothing\"); await pool.query(\"insert into content (topic, category, title, body) values ('PurgeTestTopic','PurgeTestCategory','Purge Test Title','body')\"); await pool.end(); })"
```

- [ ] **Step 3: Search + delete the report, verify gone**

```bash
curl -s "http://localhost:3000/master/purge/reports/search?outlet=ZZTEST" -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3000/master/purge/reports/delete -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"ids":["<id from search>"]}'
curl -s "http://localhost:3000/master/purge/reports/search?outlet=ZZTEST" -H "Authorization: Bearer $TOKEN"
```
Expected: first search finds 1 row, delete returns `{"status":"ok","deletedCount":1}`, final search returns `{"reports":[]}`.

- [ ] **Step 4: Search + delete the content entry, verify gone**

```bash
curl -s "http://localhost:3000/master/purge/content/search?category=PurgeTestCategory" -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3000/master/purge/content/delete -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"ids":["<id from search>"]}'
curl -s "http://localhost:3000/master/purge/content/search?category=PurgeTestCategory" -H "Authorization: Bearer $TOKEN"
```
Expected: same pattern — found, deleted, gone.

- [ ] **Step 5: Confirm `master_delete_log` has one row per delete call from this whole task**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { const r = await pool.query(\"select entity_type, deleted_count from master_delete_log where entity_type in ('report','content') order by id desc limit 2\"); console.log(r.rows); await pool.end(); })"
```
Expected: 2 rows, one `report`/`1`, one `content`/`1`.

- [ ] **Step 6: Clean up remaining seed data and stop the dev server**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { await pool.query(\"delete from staff_roster where outlet='ZZTEST'\"); await pool.query(\"delete from manager_credentials where scope_key='ZZTEST'\"); await pool.end(); })"
```
Stop the `npm run dev` process started in Task 2.

- [ ] **Step 7: Commit**

```bash
git add src/routes/masterPurge.js
git commit -m "feat: add Master reports/content purge search+delete endpoints"
```

---

## Task 6: Frontend `api/client.js` — purge functions

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js`

**Interfaces:**
- Consumes: `request(path, options)` helper already in this file; all 8 backend routes from Tasks 2-5.
- Produces: `api.masterSearchStaffForPurge(params, masterToken)`, `api.masterDeleteStaff(ids, masterToken)`, `api.masterSearchQuizAttempts(params, masterToken)`, `api.masterDeleteQuizAttempts(type, ids, masterToken)`, `api.masterSearchManagerAccounts(params, masterToken)`, `api.masterDeleteManagerAccounts(ids, masterToken)`, `api.masterSearchReports(params, masterToken)`, `api.masterDeleteReports(ids, masterToken)`, `api.masterSearchContent(params, masterToken)`, `api.masterDeleteContent(ids, masterToken)` — consumed by Tasks 8-11's panel components. `params` is a plain object of non-empty string filters.

- [ ] **Step 1: Add the 10 functions to the `api` object**, right after `masterResetSupervisorPin` (before the closing `}`):

```js
  masterSearchStaffForPurge: (params, masterToken) =>
    request(`/master/purge/staff/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteStaff: (ids, masterToken) =>
    request('/master/purge/staff/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchQuizAttempts: (params, masterToken) =>
    request(`/master/purge/quiz-attempts/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteQuizAttempts: (type, ids, masterToken) =>
    request('/master/purge/quiz-attempts/delete', { method: 'POST', body: JSON.stringify({ type, ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchManagerAccounts: (params, masterToken) =>
    request(`/master/purge/manager-accounts/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteManagerAccounts: (ids, masterToken) =>
    request('/master/purge/manager-accounts/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchReports: (params, masterToken) =>
    request(`/master/purge/reports/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteReports: (ids, masterToken) =>
    request('/master/purge/reports/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchContent: (params, masterToken) =>
    request(`/master/purge/content/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteContent: (ids, masterToken) =>
    request('/master/purge/content/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
```

- [ ] **Step 2: Build check**

Run (from `lautan-academy-frontend/`): `npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/client.js
git commit -m "feat: add api client functions for Master data-purge endpoints"
```

---

## Task 7: `MasterDeleteConfirmModal.vue` — shared confirm modal

**Files:**
- Create: `lautan-academy-frontend/src/components/MasterDeleteConfirmModal.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Produces: component with props `title: String (required)`, `breakdown: Array<{label:String,count:Number}> (required)`, `warning: String (default '')`, `loading: Boolean (default false)`; emits `confirm`, `cancel`. Consumed by Tasks 8-11.

- [ ] **Step 1: Create the component**

```vue
<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps({
  title: { type: String, required: true },
  breakdown: { type: Array, required: true },
  warning: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])

const confirmText = ref('')
const canConfirm = computed(() => confirmText.value.trim().toUpperCase() === 'DELETE')
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 px-4" @click.self="emit('cancel')">
      <div class="w-full max-w-md bg-white rounded-xl2 shadow-lg p-5 space-y-4">
        <h3 class="font-display font-semibold text-ink text-base">{{ title }}</h3>
        <ul class="text-sm text-slate space-y-1 border border-seafoam rounded-lg p-3">
          <li v-for="row in breakdown" :key="row.label" class="flex justify-between">
            <span>{{ row.label }}</span>
            <span class="font-medium text-ink">{{ row.count }}</span>
          </li>
        </ul>
        <p v-if="warning" class="text-xs text-coral">{{ warning }}</p>
        <div>
          <label for="purge-confirm-input" class="block text-xs text-slate mb-1">{{ t('masterPanel.dataPurge.confirmModal.typeToConfirm') }}</label>
          <input
            id="purge-confirm-input"
            v-model="confirmText"
            type="text"
            :placeholder="t('masterPanel.dataPurge.confirmModal.placeholder')"
            class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm"
          />
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" @click="emit('cancel')" class="text-slate text-sm px-4 py-2 rounded-lg border border-slate/30">
            {{ t('masterPanel.dataPurge.confirmModal.cancel') }}
          </button>
          <button
            type="button"
            :disabled="!canConfirm || loading"
            @click="emit('confirm')"
            class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {{ loading ? t('masterPanel.dataPurge.confirmModal.deleting') : t('masterPanel.dataPurge.confirmModal.deleteButton') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: Add i18n keys** — in `src/i18n/locales/en.json`, inside the existing `"masterPanel"` object, add a new `"dataPurge"` key (sibling of `"tab"` and `"pinReset"`):

```json
    "dataPurge": {
      "confirmModal": {
        "typeToConfirm": "Type DELETE to confirm",
        "placeholder": "DELETE",
        "cancel": "Cancel",
        "deleteButton": "Delete",
        "deleting": "Deleting..."
      }
    }
```

In `src/i18n/locales/ms.json`, same location:

```json
    "dataPurge": {
      "confirmModal": {
        "typeToConfirm": "Taip DELETE untuk sahkan",
        "placeholder": "DELETE",
        "cancel": "Batal",
        "deleteButton": "Padam",
        "deleting": "Memadam..."
      }
    }
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean build (component isn't mounted anywhere yet, this just confirms no syntax errors and valid JSON).

- [ ] **Step 4: Commit**

```bash
git add src/components/MasterDeleteConfirmModal.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add shared MasterDeleteConfirmModal component"
```

---

## Task 8: `PurgeStaffPanel.vue`

**Files:**
- Create: `lautan-academy-frontend/src/components/PurgeStaffPanel.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.masterSearchStaffForPurge`, `api.masterDeleteStaff` (Task 6); `useMasterAuthStore` (`masterAuth.token`); `MasterDeleteConfirmModal` (Task 7).
- Produces: component with no props, no emits needed beyond none (self-contained). Consumed by Task 12 (`MasterDataPurge.vue`) as `<PurgeStaffPanel />`.

- [ ] **Step 1: Create the component**

```vue
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const outletFilter = ref('')
const nameFilter = ref('')
const results = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const showConfirm = ref(false)
const deleting = ref(false)
const status = ref('')
const statusOk = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    const params = {}
    if (outletFilter.value.trim()) params.outlet = outletFilter.value.trim()
    if (nameFilter.value.trim()) params.name = nameFilter.value.trim()
    const data = await api.masterSearchStaffForPurge(params, masterAuth.token)
    results.value = data.staff || []
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.staff.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

function toggle(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function breakdown() {
  const rows = results.value.filter(r => selected.value.has(r.id))
  const totals = { staff: rows.length, results: 0, wrongAnswers: 0, aiResults: 0, aiWrongAnswers: 0, reports: 0 }
  for (const r of rows) {
    totals.results += r.relatedCounts.results
    totals.wrongAnswers += r.relatedCounts.wrongAnswers
    totals.aiResults += r.relatedCounts.aiResults
    totals.aiWrongAnswers += r.relatedCounts.aiWrongAnswers
    totals.reports += r.relatedCounts.reports
  }
  return [
    { label: t('masterPanel.dataPurge.staff.breakdownStaff'), count: totals.staff },
    { label: t('masterPanel.dataPurge.staff.breakdownResults'), count: totals.results },
    { label: t('masterPanel.dataPurge.staff.breakdownWrongAnswers'), count: totals.wrongAnswers },
    { label: t('masterPanel.dataPurge.staff.breakdownAiResults'), count: totals.aiResults },
    { label: t('masterPanel.dataPurge.staff.breakdownAiWrongAnswers'), count: totals.aiWrongAnswers },
    { label: t('masterPanel.dataPurge.staff.breakdownReports'), count: totals.reports },
  ]
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = await api.masterDeleteStaff(ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.staff.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.staff.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <input v-model="outletFilter" type="text" :placeholder="t('masterPanel.dataPurge.staff.outletPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="nameFilter" type="text" :placeholder="t('masterPanel.dataPurge.staff.namePlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.staff.searching') : t('masterPanel.dataPurge.staff.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[36rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.staff.colOutlet') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.staff.colName') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.staff.colRelated') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <td class="p-2 text-ink">{{ r.outlet }}</td>
            <td class="p-2 text-ink">{{ r.name }}</td>
            <td class="p-2 text-slate text-xs">
              {{ t('masterPanel.dataPurge.staff.relatedSummary', { results: r.relatedCounts.results, ai: r.relatedCounts.aiResults, reports: r.relatedCounts.reports }) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.staff.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.staff.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.dataPurge.staff.confirmTitle')"
      :breakdown="breakdown()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys** — in both locale files, inside `masterPanel.dataPurge`, add a `"staff"` key:

`en.json`:
```json
      "staff": {
        "outletPlaceholder": "Outlet (e.g. R3-ABC)",
        "namePlaceholder": "Staff name",
        "search": "Search",
        "searching": "Searching...",
        "errorSearchFailed": "Search failed.",
        "noResults": "No staff accounts found.",
        "colOutlet": "Outlet",
        "colName": "Name",
        "colRelated": "Related data",
        "relatedSummary": "{results} quiz results, {ai} AI results, {reports} reports",
        "deleteSelected": "Delete Selected ({count})",
        "confirmTitle": "Delete staff account(s)?",
        "breakdownStaff": "Staff accounts",
        "breakdownResults": "Module Quiz results",
        "breakdownWrongAnswers": "Module Quiz wrong answers",
        "breakdownAiResults": "AI Practice results",
        "breakdownAiWrongAnswers": "AI Practice wrong answers",
        "breakdownReports": "Assessment reports",
        "successDeleted": "Deleted {count} row(s).",
        "errorDeleteFailed": "Delete failed."
      }
```

`ms.json`:
```json
      "staff": {
        "outletPlaceholder": "Outlet (cth. R3-ABC)",
        "namePlaceholder": "Nama staf",
        "search": "Cari",
        "searching": "Mencari...",
        "errorSearchFailed": "Carian gagal.",
        "noResults": "Tiada akaun staf dijumpai.",
        "colOutlet": "Outlet",
        "colName": "Nama",
        "colRelated": "Data berkaitan",
        "relatedSummary": "{results} keputusan kuiz, {ai} keputusan AI, {reports} laporan",
        "deleteSelected": "Padam Terpilih ({count})",
        "confirmTitle": "Padam akaun staf?",
        "breakdownStaff": "Akaun staf",
        "breakdownResults": "Keputusan Module Quiz",
        "breakdownWrongAnswers": "Jawapan salah Module Quiz",
        "breakdownAiResults": "Keputusan AI Practice",
        "breakdownAiWrongAnswers": "Jawapan salah AI Practice",
        "breakdownReports": "Laporan penilaian",
        "successDeleted": "{count} baris dipadam.",
        "errorDeleteFailed": "Padam gagal."
      }
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/PurgeStaffPanel.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add PurgeStaffPanel component for Master data purge"
```

---

## Task 9: `PurgeQuizAttemptsPanel.vue`

**Files:**
- Create: `lautan-academy-frontend/src/components/PurgeQuizAttemptsPanel.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.masterSearchQuizAttempts`, `api.masterDeleteQuizAttempts` (Task 6); `useMasterAuthStore`; `MasterDeleteConfirmModal` (Task 7).
- Produces: component with no props/emits. Consumed by Task 12 as `<PurgeQuizAttemptsPanel />`.

- [ ] **Step 1: Create the component**

```vue
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const type = ref('standard') // 'standard' | 'ai'
const outletFilter = ref('')
const nameFilter = ref('')
const topicFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const results = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const showConfirm = ref(false)
const deleting = ref(false)
const status = ref('')
const statusOk = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    const params = { type: type.value }
    if (outletFilter.value.trim()) params.outlet = outletFilter.value.trim()
    if (nameFilter.value.trim()) params.name = nameFilter.value.trim()
    if (topicFilter.value.trim()) params.topic = topicFilter.value.trim()
    if (dateFrom.value) params.dateFrom = dateFrom.value
    if (dateTo.value) params.dateTo = dateTo.value
    const data = await api.masterSearchQuizAttempts(params, masterAuth.token)
    results.value = data.attempts || []
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.quizAttempts.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

function toggle(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function breakdown() {
  const rows = results.value.filter(r => selected.value.has(r.id))
  return [
    { label: t('masterPanel.dataPurge.quizAttempts.breakdownAttempts'), count: rows.length },
  ]
}

function legacyWarning() {
  const rows = results.value.filter(r => selected.value.has(r.id))
  const legacyCount = rows.filter(r => !r.hasAttemptId).length
  return legacyCount ? t('masterPanel.dataPurge.quizAttempts.legacyWarning', { count: legacyCount }) : ''
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = await api.masterDeleteQuizAttempts(type.value, ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.quizAttempts.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.quizAttempts.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-2 text-sm">
      <button type="button" @click="type = 'standard'" class="px-3 py-1.5 rounded-full" :class="type === 'standard' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.quizAttempts.typeStandard') }}
      </button>
      <button type="button" @click="type = 'ai'" class="px-3 py-1.5 rounded-full" :class="type === 'ai' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.quizAttempts.typeAi') }}
      </button>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap gap-2 items-end">
      <input v-model="outletFilter" type="text" :placeholder="t('masterPanel.dataPurge.quizAttempts.outletPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="nameFilter" type="text" :placeholder="t('masterPanel.dataPurge.quizAttempts.namePlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="topicFilter" type="text" :placeholder="t('masterPanel.dataPurge.quizAttempts.topicPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <label class="text-xs text-slate">{{ t('masterPanel.dataPurge.quizAttempts.dateFromLabel') }}
        <input v-model="dateFrom" type="date" class="block border border-slate/30 rounded-lg py-1.5 px-2 text-sm" />
      </label>
      <label class="text-xs text-slate">{{ t('masterPanel.dataPurge.quizAttempts.dateToLabel') }}
        <input v-model="dateTo" type="date" class="block border border-slate/30 rounded-lg py-1.5 px-2 text-sm" />
      </label>
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.quizAttempts.searching') : t('masterPanel.dataPurge.quizAttempts.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[40rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colOutlet') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colName') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colTopic') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colScore') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colDate') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <td class="p-2 text-ink">{{ r.outlet }}</td>
            <td class="p-2 text-ink">{{ r.name }}</td>
            <td class="p-2 text-ink">{{ r.topic }}</td>
            <td class="p-2 text-slate text-xs">
              {{ r.percentage }}
              <span v-if="!r.hasAttemptId" class="ml-1 text-coral">{{ t('masterPanel.dataPurge.quizAttempts.legacyBadge') }}</span>
            </td>
            <td class="p-2 text-slate text-xs">{{ new Date(r.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.quizAttempts.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.quizAttempts.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.dataPurge.quizAttempts.confirmTitle')"
      :breakdown="breakdown()"
      :warning="legacyWarning()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys** — inside `masterPanel.dataPurge`, add a `"quizAttempts"` key:

`en.json`:
```json
      "quizAttempts": {
        "typeStandard": "Module Quiz",
        "typeAi": "AI Practice",
        "outletPlaceholder": "Outlet",
        "namePlaceholder": "Staff name",
        "topicPlaceholder": "Topic",
        "dateFromLabel": "From",
        "dateToLabel": "To",
        "search": "Search",
        "searching": "Searching...",
        "errorSearchFailed": "Search failed.",
        "noResults": "No quiz attempts found.",
        "colOutlet": "Outlet",
        "colName": "Name",
        "colTopic": "Topic",
        "colScore": "Score",
        "colDate": "Date",
        "legacyBadge": "No attempt link",
        "deleteSelected": "Delete Selected ({count})",
        "confirmTitle": "Delete quiz attempt(s)?",
        "breakdownAttempts": "Quiz attempts",
        "legacyWarning": "{count} selected attempt(s) have no attempt link — their wrong answers will not be removed.",
        "successDeleted": "Deleted {count} row(s).",
        "errorDeleteFailed": "Delete failed."
      }
```

`ms.json`:
```json
      "quizAttempts": {
        "typeStandard": "Module Quiz",
        "typeAi": "AI Practice",
        "outletPlaceholder": "Outlet",
        "namePlaceholder": "Nama staf",
        "topicPlaceholder": "Topik",
        "dateFromLabel": "Dari",
        "dateToLabel": "Hingga",
        "search": "Cari",
        "searching": "Mencari...",
        "errorSearchFailed": "Carian gagal.",
        "noResults": "Tiada percubaan kuiz dijumpai.",
        "colOutlet": "Outlet",
        "colName": "Nama",
        "colTopic": "Topik",
        "colScore": "Skor",
        "colDate": "Tarikh",
        "legacyBadge": "Tiada pautan percubaan",
        "deleteSelected": "Padam Terpilih ({count})",
        "confirmTitle": "Padam percubaan kuiz?",
        "breakdownAttempts": "Percubaan kuiz",
        "legacyWarning": "{count} percubaan terpilih tiada pautan percubaan — jawapan salah tidak akan dipadam.",
        "successDeleted": "{count} baris dipadam.",
        "errorDeleteFailed": "Padam gagal."
      }
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/PurgeQuizAttemptsPanel.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add PurgeQuizAttemptsPanel component for Master data purge"
```

---

## Task 10: `PurgeManagerAccountsPanel.vue`

**Files:**
- Create: `lautan-academy-frontend/src/components/PurgeManagerAccountsPanel.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.masterSearchManagerAccounts`, `api.masterDeleteManagerAccounts` (Task 6); `useMasterAuthStore`; `MasterDeleteConfirmModal` (Task 7).
- Produces: component with no props/emits. Consumed by Task 12 as `<PurgeManagerAccountsPanel />`.

- [ ] **Step 1: Create the component**

```vue
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const roleFilter = ref('')
const scopeKeyFilter = ref('')
const results = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const showConfirm = ref(false)
const deleting = ref(false)
const status = ref('')
const statusOk = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    const params = {}
    if (roleFilter.value) params.role = roleFilter.value
    if (scopeKeyFilter.value.trim()) params.scopeKey = scopeKeyFilter.value.trim()
    const data = await api.masterSearchManagerAccounts(params, masterAuth.token)
    results.value = data.accounts || []
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.managerAccounts.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

function toggle(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function breakdown() {
  return [
    { label: t('masterPanel.dataPurge.managerAccounts.breakdownAccounts'), count: selected.value.size },
  ]
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = await api.masterDeleteManagerAccounts(ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.managerAccounts.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.managerAccounts.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <select v-model="roleFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.dataPurge.managerAccounts.roleAll') }}</option>
        <option value="outlet_manager">{{ t('masterPanel.dataPurge.managerAccounts.roleOutletManager') }}</option>
        <option value="warehouse_manager">{{ t('masterPanel.dataPurge.managerAccounts.roleWarehouseManager') }}</option>
        <option value="area_manager">{{ t('masterPanel.dataPurge.managerAccounts.roleAreaManager') }}</option>
      </select>
      <input v-model="scopeKeyFilter" type="text" :placeholder="t('masterPanel.dataPurge.managerAccounts.scopeKeyPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.managerAccounts.searching') : t('masterPanel.dataPurge.managerAccounts.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[28rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.managerAccounts.colRole') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.managerAccounts.colScopeKey') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.managerAccounts.colCreated') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <td class="p-2 text-ink">{{ r.role }}</td>
            <td class="p-2 text-ink">{{ r.scopeKey }}</td>
            <td class="p-2 text-slate text-xs">{{ new Date(r.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.managerAccounts.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.managerAccounts.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.dataPurge.managerAccounts.confirmTitle')"
      :breakdown="breakdown()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys** — inside `masterPanel.dataPurge`, add a `"managerAccounts"` key:

`en.json`:
```json
      "managerAccounts": {
        "roleAll": "All roles",
        "roleOutletManager": "Outlet Manager",
        "roleWarehouseManager": "Warehouse Manager",
        "roleAreaManager": "Area Manager",
        "scopeKeyPlaceholder": "Outlet / area code",
        "search": "Search",
        "searching": "Searching...",
        "errorSearchFailed": "Search failed.",
        "noResults": "No manager accounts found.",
        "colRole": "Role",
        "colScopeKey": "Outlet / Area",
        "colCreated": "Created",
        "deleteSelected": "Delete Selected ({count})",
        "confirmTitle": "Delete manager account(s)?",
        "breakdownAccounts": "Manager accounts",
        "successDeleted": "Deleted {count} account(s).",
        "errorDeleteFailed": "Delete failed."
      }
```

`ms.json`:
```json
      "managerAccounts": {
        "roleAll": "Semua peranan",
        "roleOutletManager": "Pengurus Outlet",
        "roleWarehouseManager": "Pengurus Gudang",
        "roleAreaManager": "Pengurus Kawasan",
        "scopeKeyPlaceholder": "Kod outlet / kawasan",
        "search": "Cari",
        "searching": "Mencari...",
        "errorSearchFailed": "Carian gagal.",
        "noResults": "Tiada akaun pengurus dijumpai.",
        "colRole": "Peranan",
        "colScopeKey": "Outlet / Kawasan",
        "colCreated": "Dicipta",
        "deleteSelected": "Padam Terpilih ({count})",
        "confirmTitle": "Padam akaun pengurus?",
        "breakdownAccounts": "Akaun pengurus",
        "successDeleted": "{count} akaun dipadam.",
        "errorDeleteFailed": "Padam gagal."
      }
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/PurgeManagerAccountsPanel.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add PurgeManagerAccountsPanel component for Master data purge"
```

---

## Task 11: `PurgeReportsContentPanel.vue`

**Files:**
- Create: `lautan-academy-frontend/src/components/PurgeReportsContentPanel.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.masterSearchReports`, `api.masterDeleteReports`, `api.masterSearchContent`, `api.masterDeleteContent` (Task 6); `useMasterAuthStore`; `MasterDeleteConfirmModal` (Task 7).
- Produces: component with no props/emits. Consumed by Task 12 as `<PurgeReportsContentPanel />`.

- [ ] **Step 1: Create the component**

```vue
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const mode = ref('reports') // 'reports' | 'content'
const outletFilter = ref('')
const staffNameFilter = ref('')
const topicFilter = ref('')
const categoryFilter = ref('')
const results = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const showConfirm = ref(false)
const deleting = ref(false)
const status = ref('')
const statusOk = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    if (mode.value === 'reports') {
      const params = {}
      if (outletFilter.value.trim()) params.outlet = outletFilter.value.trim()
      if (staffNameFilter.value.trim()) params.staffName = staffNameFilter.value.trim()
      if (topicFilter.value.trim()) params.topic = topicFilter.value.trim()
      const data = await api.masterSearchReports(params, masterAuth.token)
      results.value = data.reports || []
    } else {
      const params = {}
      if (categoryFilter.value.trim()) params.category = categoryFilter.value.trim()
      if (topicFilter.value.trim()) params.topic = topicFilter.value.trim()
      const data = await api.masterSearchContent(params, masterAuth.token)
      results.value = data.content || []
    }
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.reportsContent.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

function switchMode(next) {
  mode.value = next
  results.value = []
  selected.value = new Set()
  status.value = ''
}

function toggle(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function breakdown() {
  const label = mode.value === 'reports'
    ? t('masterPanel.dataPurge.reportsContent.breakdownReports')
    : t('masterPanel.dataPurge.reportsContent.breakdownContent')
  return [{ label, count: selected.value.size }]
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = mode.value === 'reports'
      ? await api.masterDeleteReports(ids, masterAuth.token)
      : await api.masterDeleteContent(ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.reportsContent.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.reportsContent.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-2 text-sm">
      <button type="button" @click="switchMode('reports')" class="px-3 py-1.5 rounded-full" :class="mode === 'reports' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.reportsContent.toggleReports') }}
      </button>
      <button type="button" @click="switchMode('content')" class="px-3 py-1.5 rounded-full" :class="mode === 'content' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.reportsContent.toggleContent') }}
      </button>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <template v-if="mode === 'reports'">
        <input v-model="outletFilter" type="text" :placeholder="t('masterPanel.dataPurge.reportsContent.outletPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
        <input v-model="staffNameFilter" type="text" :placeholder="t('masterPanel.dataPurge.reportsContent.staffNamePlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      </template>
      <template v-else>
        <input v-model="categoryFilter" type="text" :placeholder="t('masterPanel.dataPurge.reportsContent.categoryPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      </template>
      <input v-model="topicFilter" type="text" :placeholder="t('masterPanel.dataPurge.reportsContent.topicPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.reportsContent.searching') : t('masterPanel.dataPurge.reportsContent.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[32rem]">
        <thead v-if="mode === 'reports'">
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colOutlet') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colStaffName') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colTopic') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colManager') }}</th>
          </tr>
        </thead>
        <thead v-else>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colCategory') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colTopic') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colTitle') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <template v-if="mode === 'reports'">
              <td class="p-2 text-ink">{{ r.outlet }}</td>
              <td class="p-2 text-ink">{{ r.staffName }}</td>
              <td class="p-2 text-ink">{{ r.topic }}</td>
              <td class="p-2 text-slate text-xs">{{ r.manager }}</td>
            </template>
            <template v-else>
              <td class="p-2 text-ink">{{ r.category }}</td>
              <td class="p-2 text-ink">{{ r.topic }}</td>
              <td class="p-2 text-slate text-xs">{{ r.title }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.reportsContent.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.reportsContent.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="mode === 'reports' ? t('masterPanel.dataPurge.reportsContent.confirmTitleReports') : t('masterPanel.dataPurge.reportsContent.confirmTitleContent')"
      :breakdown="breakdown()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys** — inside `masterPanel.dataPurge`, add a `"reportsContent"` key:

`en.json`:
```json
      "reportsContent": {
        "toggleReports": "Reports",
        "toggleContent": "Content",
        "outletPlaceholder": "Outlet",
        "staffNamePlaceholder": "Staff name",
        "topicPlaceholder": "Topic",
        "categoryPlaceholder": "Category",
        "search": "Search",
        "searching": "Searching...",
        "errorSearchFailed": "Search failed.",
        "noResults": "No records found.",
        "colOutlet": "Outlet",
        "colStaffName": "Staff",
        "colTopic": "Topic",
        "colManager": "Manager",
        "colCategory": "Category",
        "colTitle": "Title",
        "deleteSelected": "Delete Selected ({count})",
        "confirmTitleReports": "Delete report(s)?",
        "confirmTitleContent": "Delete content entry(ies)?",
        "breakdownReports": "Reports",
        "breakdownContent": "Content entries",
        "successDeleted": "Deleted {count} row(s).",
        "errorDeleteFailed": "Delete failed."
      }
```

`ms.json`:
```json
      "reportsContent": {
        "toggleReports": "Laporan",
        "toggleContent": "Kandungan",
        "outletPlaceholder": "Outlet",
        "staffNamePlaceholder": "Nama staf",
        "topicPlaceholder": "Topik",
        "categoryPlaceholder": "Kategori",
        "search": "Cari",
        "searching": "Mencari...",
        "errorSearchFailed": "Carian gagal.",
        "noResults": "Tiada rekod dijumpai.",
        "colOutlet": "Outlet",
        "colStaffName": "Staf",
        "colTopic": "Topik",
        "colManager": "Pengurus",
        "colCategory": "Kategori",
        "colTitle": "Tajuk",
        "deleteSelected": "Padam Terpilih ({count})",
        "confirmTitleReports": "Padam laporan?",
        "confirmTitleContent": "Padam entri kandungan?",
        "breakdownReports": "Laporan",
        "breakdownContent": "Entri kandungan",
        "successDeleted": "{count} baris dipadam.",
        "errorDeleteFailed": "Padam gagal."
      }
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/PurgeReportsContentPanel.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add PurgeReportsContentPanel component for Master data purge"
```

---

## Task 12: `MasterDataPurge.vue` — sub-tab shell

**Files:**
- Create: `lautan-academy-frontend/src/components/MasterDataPurge.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `PurgeStaffPanel` (Task 8), `PurgeQuizAttemptsPanel` (Task 9), `PurgeManagerAccountsPanel` (Task 10), `PurgeReportsContentPanel` (Task 11).
- Produces: component emitting `close` (matches `MasterPinReset.vue`'s existing pattern). Consumed by Task 13 as `<MasterDataPurge @close="activeTab = null" />`.

- [ ] **Step 1: Create the component**

```vue
<script setup>
// Master-only: search + bulk hard-delete across 4 test-data entity types.
// Mirrors MasterPinReset.vue's back/close pattern. See
// docs/superpowers/specs/2026-08-11-master-subsystem-c-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PurgeStaffPanel from './PurgeStaffPanel.vue'
import PurgeQuizAttemptsPanel from './PurgeQuizAttemptsPanel.vue'
import PurgeManagerAccountsPanel from './PurgeManagerAccountsPanel.vue'
import PurgeReportsContentPanel from './PurgeReportsContentPanel.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()

const SUB_TABS = ['staff', 'quizAttempts', 'managerAccounts', 'reportsContent']
const activeSubTab = ref('staff')
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.dataPurge.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.dataPurge.title') }}</h3>
    </div>

    <div class="flex flex-wrap gap-2 text-sm border-b border-seafoam pb-3">
      <button
        v-for="tabKey in SUB_TABS"
        :key="tabKey"
        type="button"
        @click="activeSubTab = tabKey"
        class="px-3 py-1.5 rounded-full"
        :class="activeSubTab === tabKey ? 'bg-aqua text-white' : 'bg-seafoam text-ink'"
      >
        {{ t(`masterPanel.dataPurge.subTab${tabKey.charAt(0).toUpperCase()}${tabKey.slice(1)}`) }}
      </button>
    </div>

    <PurgeStaffPanel v-if="activeSubTab === 'staff'" />
    <PurgeQuizAttemptsPanel v-else-if="activeSubTab === 'quizAttempts'" />
    <PurgeManagerAccountsPanel v-else-if="activeSubTab === 'managerAccounts'" />
    <PurgeReportsContentPanel v-else-if="activeSubTab === 'reportsContent'" />
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys** — inside `masterPanel.dataPurge`, add these top-level keys (siblings of `confirmModal`/`staff`/`quizAttempts`/`managerAccounts`/`reportsContent`):

`en.json`:
```json
      "title": "Test Data Purge",
      "back": "Back",
      "subTabStaff": "Staff",
      "subTabQuizAttempts": "Quiz Attempts",
      "subTabManagerAccounts": "Manager Accounts",
      "subTabReportsContent": "Reports & Content",
```

`ms.json`:
```json
      "title": "Padam Data Ujian",
      "back": "Kembali",
      "subTabStaff": "Staf",
      "subTabQuizAttempts": "Percubaan Kuiz",
      "subTabManagerAccounts": "Akaun Pengurus",
      "subTabReportsContent": "Laporan & Kandungan",
```

- [ ] **Step 3: EN/BM key-parity check**

Run: `node -e "const en=require('./src/i18n/locales/en.json'); const ms=require('./src/i18n/locales/ms.json'); function keys(o,p=''){return Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v!==null?keys(v,p+k+'.'):[p+k])}; const ek=keys(en), mk=keys(ms); const missing=ek.filter(k=>!mk.includes(k)); const extra=mk.filter(k=>!ek.includes(k)); console.log('missing in ms:',missing); console.log('extra in ms:',extra)"`
Expected: both arrays empty.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/components/MasterDataPurge.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add MasterDataPurge sub-tab shell for Master data purge"
```

---

## Task 13: Wire into `MasterPanel.vue`, widen drawer, final verification

**Files:**
- Modify: `lautan-academy-frontend/src/components/MasterPanel.vue`

**Interfaces:**
- Consumes: `MasterDataPurge` (Task 12).
- Produces: `dataPurge` tab fully enabled and reachable from the Master Panel.

- [ ] **Step 1: Import and enable the tab**

In `MasterPanel.vue`, add the import next to `MasterPinReset`:

```js
import MasterDataPurge from './MasterDataPurge.vue'
```

Change:
```js
const ENABLED_TABS = ['pinReset']
```
to:
```js
const ENABLED_TABS = ['pinReset', 'dataPurge']
```

- [ ] **Step 2: Widen the drawer only for the `dataPurge` tab**

Change the container `<div>`'s class from:
```html
<div class="w-full max-w-sm h-full bg-white shadow-lg flex flex-col">
```
to:
```html
<div class="w-full h-full bg-white shadow-lg flex flex-col" :class="activeTab === 'dataPurge' ? 'max-w-3xl' : 'max-w-sm'">
```

- [ ] **Step 3: Render `MasterDataPurge` for its tab**

Change:
```html
<MasterPinReset v-if="activeTab === 'pinReset'" @close="activeTab = null" />

<nav v-else class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
```
to:
```html
<MasterPinReset v-if="activeTab === 'pinReset'" @close="activeTab = null" />
<MasterDataPurge v-else-if="activeTab === 'dataPurge'" @close="activeTab = null" />

<nav v-else class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Start both dev servers**

Backend (from `lautan-academy-backend/`): `npm run dev`
Frontend (from `lautan-academy-frontend/`): `npm run dev`

- [ ] **Step 6: Manual browser click-through — EN**

Open the frontend dev URL. Click the Key icon → Master Login → log in → Master Panel opens → click "Data Purge" tab.
Verify: drawer visibly widens (not the narrow ~384px width used by PIN Reset). All 4 sub-tab pills render (Staff, Quiz Attempts, Manager Accounts, Reports & Content) and switch panels on click.
For each of the 4 panels: run a search with a filter that matches nothing real (e.g. outlet `ZZZNONE`) → confirm "no results" message shows, no errors in console. If any real throwaway/test data exists, select a row, click "Delete Selected", confirm the modal shows the row-count breakdown, confirm the Delete button stays disabled until typing `DELETE` exactly, then Cancel (don't actually delete real data during this click-through unless it's confirmed throwaway).

- [ ] **Step 7: Manual browser click-through — MS**

Switch the language toggle to BM. Repeat the same click-through as Step 6: tab labels, sub-tab pills, search placeholders, "no results" message, and the confirm modal's "Taip DELETE untuk sahkan" text all render in Bahasa Malaysia with no untranslated English strings or missing-key fallbacks (raw key strings like `masterPanel.dataPurge.staff.search` showing up would indicate a missing translation).

- [ ] **Step 8: Confirm other Master Panel tabs are unaffected**

Click back to the tab list, open "PIN Reset" — confirm it still renders at the narrow `max-w-sm` width (proves the width change is scoped to `dataPurge` only, not global).

- [ ] **Step 9: Commit**

```bash
git add src/components/MasterPanel.vue
git commit -m "feat: wire Data Purge tab into Master Panel, widen drawer for its tab"
```

---

## Final step: update MEMORY.md and SCOPE_TRACKER.md

Per `CLAUDE.md` rule 5 — after all 13 tasks are verified:
- Summarize outcomes in `lautan-academy/MEMORY.md` under the Master Subsystem breakdown (mark C as DONE, matching the style of A and B's entries).
- No `SCOPE_TRACKER.md` checkbox exists for individual master subsystems (that tracker covers the original GAS→Vue/Node migration, not the Master subsystem build) — leave it untouched, consistent with how Subsystems A and B handled this.
- Prompt the user to `/clear`.
