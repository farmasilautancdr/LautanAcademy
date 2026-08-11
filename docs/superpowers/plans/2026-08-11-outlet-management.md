# Outlet & Area Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master can add, deactivate, and reactivate outlets and areas (and warehouse locations) from the app's Control Panel — no code edits, no redeploy — as Farmasi Lautan opens new outlets/regions.

**Architecture:** New `areas` and `outlets` Postgres tables replace the hardcoded `AREAS`/`OUTLET_LIST`/`WAREHOUSE_LOCATIONS` arrays duplicated across the backend and ~10 frontend files. A public read router (`GET /outlets`, `GET /areas`) backs every login/registration dropdown; a Master-only write router (`/master/outlets`) backs a new Control Panel tab. Every existing backend call site that validated against the static `config/areas.js` switches to a DB query. Every frontend call site that imported the static arrays switches to a new `useOutlets()` composable — the codebase's first composable, justified because it collapses 11 duplicate copies into one fetch.

**Tech Stack:** Node.js/Express/`pg` (backend), Vue 3 + `vue-i18n` + Pinia (frontend). No new dependencies either side.

## Global Constraints

- **Postgres table is named `store_outlets`, not `outlets`** (discovered during Task 1 execution, not anticipated in the original design spec). This Supabase project already has an unrelated `outlets` table with 4 dependent tables (`staff`, `quizzes`, `attempts`, `manager_reviews`) that don't match this codebase's own `schema.sql` at all — a separate app's data sharing the same DB, not abandoned test cruft. Not touched, same reasoning as `schema.sql`'s existing `standard_questions` comment (a different unrelated leftover `questions` table). This only affects the Postgres identifier — the HTTP routes (`/outlets`, `/master/outlets`), route filenames (`routes/outlets.js`), JSON field names, and every frontend name (`useOutlets`, `OUTLET_LIST`, etc.) are unaffected and stay exactly as originally planned.
- Soft-delete only. No hard-delete endpoint exists anywhere in this feature — `active` boolean toggle is the only mutation besides create. Matches the approved design spec's decision.
- Master only can write (`requireAuth` + `requireMaster` on every mutating route) — matches every prior Master subsystem (B-H).
- `store_outlets.code` is the primary key other tables (`staff_roster`, `results`, `reports`, etc.) reference by free text — no rename endpoint, ever. A mistyped code is fixed by deactivating it and creating the correct one.
- `store_outlets.code` is stored with the exact casing today's hardcoded arrays already use (uppercase for retail, e.g. `'DG'`; title-case for warehouse, e.g. `'Taskforce'`). The backend's existing `.toUpperCase()` on `scope_key` in `routes/auth.js` is unchanged and orthogonal to this table.
- Area id/label split: `areas.id` is a stable short code (`'R1'`), `areas.label` is the editable manager name (`'AMIRUL'`). Display as `${id} - ${label}` wherever the old combined string (`"R1 - AMIRUL"`) used to appear.
- `sessions.id`-style bigint gotcha does not apply here — both new tables use `text` primary keys (`areas.id`, `store_outlets.code`), not `bigserial`, so there is no node-pg bigint-as-string concern for this feature.
- No test framework exists in either repo — verification is `curl` + `npm run build` + the EN/MS key-parity script (below) + live browser click-through, matching every prior Master subsystem.
- Bilingual EN/MS strings required for all new UI text, following the exact key-nesting pattern already used under `masterPanel.*` in `src/i18n/locales/{en,ms}.json`.
- This project is a single git repo rooted at `C:\Users\Hafiz\projects\lautan-academy`; the backend lives in the sibling directory `C:\Users\Hafiz\projects\lautan-academy-backend` (separate repo, independent commits), the frontend lives in `lautan-academy-frontend/` inside this repo.
- EN/MS key-parity check (run from `lautan-academy-frontend` whenever a task adds i18n keys):

```bash
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, prefix + k + '.') : [prefix + k]
  );
}
const enKeys = new Set(keys(en));
const msKeys = new Set(keys(ms));
console.log('Missing in ms:', [...enKeys].filter((k) => !msKeys.has(k)));
console.log('Missing in en:', [...msKeys].filter((k) => !enKeys.has(k)));
"
```
Expected: both arrays empty.

---

## Task 1: Backend — `areas`/`outlets` tables + seed migration

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\scripts\migrate-add-outlets.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\sql\schema.sql` (append at end, after line 208)

**Interfaces:**
- Consumes: `pool` from `../src/config/db.js`.
- Produces: `areas` table (`id text primary key`, `label text not null`, `active boolean not null default true`, `created_at timestamptz not null default now()`) and `outlets` table (`code text primary key`, `division text not null`, `area_id text references areas(id)`, `active boolean not null default true`, `created_at timestamptz not null default now()`), both seeded with today's 9 areas, 49 retail outlets, and 4 warehouse locations. Consumed by every later task.

- [ ] **Step 1: Write `scripts/migrate-add-outlets.js`**

```js
// One-off: creates areas + store_outlets tables and seeds them with the
// current hardcoded region/outlet structure (previously duplicated across
// lautan-academy-backend/src/config/areas.js and 10+ frontend files). See
// docs/superpowers/specs/2026-08-11-outlet-management-design.md.
// Table is named store_outlets, not outlets — this Supabase project already
// has an unrelated `outlets` table (with dependent staff/quizzes/attempts/
// manager_reviews tables belonging to a different app entirely, none of
// which match this codebase's own schema.sql) sharing the same DB. Not
// touched, same reasoning as schema.sql's standard_questions comment.
// Safe to re-run — table creation is if-not-exists, seed rows use
// on-conflict-do-nothing so re-running never clobbers a Master edit made
// after the first run.
import { pool } from '../src/config/db.js';

const AREAS = [
  { id: 'R1', label: 'AMIRUL', outlets: ['DG', 'DGD', 'KMD', 'KMN', 'KMSK', 'MR'] },
  { id: 'R2', label: 'HAZWANI', outlets: ['AJ', 'BJR', 'BP', 'HQCT', 'KB', 'WM', 'PDM'] },
  { id: 'R3', label: 'HARIS', outlets: ['B6', 'BB', 'CDR', 'HL', 'HQ', 'KL', 'PK'] },
  { id: 'R4', label: 'RAIHAN', outlets: ['GB', 'GBD', 'JTH', 'RJ', 'ST', 'TPOH'] },
  { id: 'R5', label: 'ADNIN', outlets: ['JL', 'JLD', 'PP', 'PSPD', 'SMR'] },
  { id: 'R6', label: 'NADHIRAH', outlets: ['KS', 'MC', 'MLR', 'TM', 'TMD', 'TMT', 'MCD'] },
  { id: 'R7', label: 'HASANUL', outlets: ['KBKK', 'KBKS', 'KBTJ', 'PC', 'PT'] },
  { id: 'R8', label: 'HAFSHAM', outlets: ['PM', 'SLS', 'TPT', 'KKR', 'PPK'] },
  { id: 'R9', label: 'IFFAH / RAIHAN', outlets: ['GM', 'CK'] },
];
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];

async function main() {
  await pool.query(`
    create table if not exists areas (
      id text primary key,
      label text not null,
      active boolean not null default true,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists store_outlets (
      code text primary key,
      division text not null,
      area_id text references areas(id),
      active boolean not null default true,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`create index if not exists store_outlets_area_idx on store_outlets (area_id)`);

  for (const area of AREAS) {
    await pool.query(
      'insert into areas (id, label) values ($1, $2) on conflict (id) do nothing',
      [area.id, area.label]
    );
    for (const code of area.outlets) {
      await pool.query(
        `insert into store_outlets (code, division, area_id) values ($1, 'retail', $2) on conflict (code) do nothing`,
        [code, area.id]
      );
    }
  }
  for (const code of WAREHOUSE_LOCATIONS) {
    await pool.query(
      `insert into store_outlets (code, division, area_id) values ($1, 'warehouse', null) on conflict (code) do nothing`,
      [code]
    );
  }

  console.log('Migration complete: areas + store_outlets tables created and seeded.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the dev DB**

Run: `cd lautan-academy-backend && node scripts/migrate-add-outlets.js`
Expected output: `Migration complete: areas + store_outlets tables created and seeded.`

- [ ] **Step 3: Verify row counts**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const areas = await pool.query('select count(*) from areas');
  const outlets = await pool.query('select count(*) from store_outlets');
  const retail = await pool.query(\"select count(*) from store_outlets where division = 'retail'\");
  const warehouse = await pool.query(\"select count(*) from store_outlets where division = 'warehouse'\");
  console.log({ areas: areas.rows[0].count, outlets: outlets.rows[0].count, retail: retail.rows[0].count, warehouse: warehouse.rows[0].count });
  await pool.end();
});
"
```
Expected: `{ areas: '9', store_outlets: '54', retail: '50', warehouse: '4' }`

- [ ] **Step 4: Append the tables to `sql/schema.sql`**

Append at the end of the file (after the existing last line, `create index if not exists idx_rate_limits_expires_at on rate_limits (expires_at);`):

```sql

-- Outlet/Area Management. Replaces the hardcoded AREAS/OUTLET_LIST/
-- WAREHOUSE_LOCATIONS arrays previously duplicated across this backend's
-- config/areas.js and 10+ frontend files — Master edits these from the
-- Control Panel now instead of a code change + redeploy. Soft-delete only
-- (active boolean); store_outlets.code has no rename endpoint since staff_roster/
-- results/reports/etc. all reference it by free text. Named store_outlets,
-- not outlets — this Supabase project already has an unrelated `outlets`
-- table (dependent staff/quizzes/attempts/manager_reviews tables belonging
-- to a different app, none matching this file's own schema) sharing the
-- same DB. Not touched, same reasoning as standard_questions above. See
-- docs/superpowers/specs/2026-08-11-outlet-management-design.md.
create table if not exists areas (
  id text primary key,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists store_outlets (
  code text primary key,
  division text not null,        -- 'retail' | 'warehouse'
  area_id text references areas(id),  -- null for warehouse
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists store_outlets_area_idx on store_outlets (area_id);
```

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add scripts/migrate-add-outlets.js sql/schema.sql
git commit -m "feat: add areas/outlets tables, seed with current region/outlet structure"
```

---

## Task 2: Backend — public read endpoints (`GET /outlets`, `GET /areas`)

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\outlets.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\index.js`

**Interfaces:**
- Consumes: `pool` from `../config/db.js`; the `areas`/`outlets` tables from Task 1.
- Produces: `GET /outlets?division=retail|warehouse` → `{ outlets: [{code, division}] }` (active only); `GET /areas` → `{ areas: [{id, label, outlets: [code, ...]}] }` (active areas with their active outlet codes nested). Consumed by Task 7's frontend composable.

- [ ] **Step 1: Write `routes/outlets.js`**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';

export const outletsRouter = Router();

// Public, no auth — same pattern as questionsRouter: every login/register
// dropdown needs this before anyone is authenticated. Active rows only;
// Master's own panel (routes/masterOutlets.js) is the one place inactive
// rows are visible, so they can be reactivated.
outletsRouter.get('/', async (req, res) => {
  const division = (req.query.division || '').toString().trim().toLowerCase();
  const conditions = ['active'];
  const params = [];
  if (division) {
    params.push(division);
    conditions.push(`division = $${params.length}`);
  }
  const { rows } = await pool.query(
    `select code, division from store_outlets where ${conditions.join(' and ')} order by code`,
    params
  );
  res.json({ outlets: rows.map(r => ({ code: r.code, division: r.division })) });
});

export const areasRouter = Router();

// Same public-no-auth reasoning as outletsRouter above. Nests each area's
// active outlet codes so callers get one request instead of joining
// GET /outlets client-side — this is exactly the shape auth.js's
// DB-backed outletsForArea() (Task 4) and the frontend's outletsForArea()
// composable helper (Task 7) both need.
areasRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    select a.id, a.label, coalesce(array_agg(o.code order by o.code) filter (where o.code is not null), '{}') as outlets
    from areas a
    left join store_outlets o on o.area_id = a.id and o.active
    where a.active
    group by a.id, a.label
    order by a.id
  `);
  res.json({ areas: rows.map(r => ({ id: r.id, label: r.label, outlets: r.outlets })) });
});
```

- [ ] **Step 2: Mount both routers in `index.js`**

Add the import (after `import { questionsRouter } from './routes/questions.js';` at `index.js:11`):

```js
import { outletsRouter, areasRouter } from './routes/outlets.js';
```

Add the mount lines (after `app.use('/questions', checkMaintenance, questionsRouter);` at `index.js:33`) — no `checkMaintenance`, since login/registration must keep working even in maintenance mode (same reasoning `/auth` is excluded):

```js
app.use('/outlets', outletsRouter);
app.use('/areas', areasRouter);
```

- [ ] **Step 3: Run it and verify with curl**

Run: `cd lautan-academy-backend && npm run dev` (leave running in a separate terminal)

```bash
curl -s http://localhost:3000/outlets | head -c 300
curl -s "http://localhost:3000/outlets?division=warehouse"
curl -s http://localhost:3000/areas | head -c 400
```
Expected: first call returns 49+4=53 outlets as JSON; second returns exactly the 4 warehouse locations; third returns 9 areas each with an `outlets` array matching Task 1's seed data (e.g. `R1` → `["DG","DGD","KMD","KMN","KMSK","MR"]`).

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-backend
git add src/routes/outlets.js src/index.js
git commit -m "feat: add public GET /outlets and GET /areas endpoints"
```

---

## Task 3: Backend — Master write endpoints (`/master/outlets`)

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\masterOutlets.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\index.js`

**Interfaces:**
- Consumes: `pool`, `requireAuth`/`requireMaster` from `../middleware/auth.js`, `logAudit` from `../services/auditLog.js`.
- Produces: `GET /master/outlets` (areas+outlets incl. inactive), `POST /master/outlets/areas`, `PATCH /master/outlets/areas/:id`, `POST /master/outlets`, `PATCH /master/outlets/:code`. Consumed by Task 11's `MasterOutletsPanel.vue`.

- [ ] **Step 1: Write `routes/masterOutlets.js`**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';
import { logAudit } from '../services/auditLog.js';

export const masterOutletsRouter = Router();

// Same shape as the public GET /outlets + GET /areas, but includes
// inactive rows — Master's panel needs to see and reactivate deactivated
// entries, not just the active ones the public dropdowns show.
masterOutletsRouter.get('/', requireAuth, requireMaster, async (req, res) => {
  const [areasResult, outletsResult] = await Promise.all([
    pool.query('select id, label, active from areas order by id'),
    pool.query('select code, division, area_id, active from store_outlets order by division, code'),
  ]);
  res.json({
    areas: areasResult.rows.map(a => ({ id: a.id, label: a.label, active: a.active })),
    outlets: outletsResult.rows.map(o => ({ code: o.code, division: o.division, areaId: o.area_id, active: o.active })),
  });
});

masterOutletsRouter.post('/areas', requireAuth, requireMaster, async (req, res) => {
  const id = (req.body.id || '').toString().trim();
  const label = (req.body.label || '').toString().trim();
  if (!id || !label) {
    return res.status(400).json({ status: 'error', error: 'Area id and label are required.' });
  }

  try {
    await pool.query('insert into areas (id, label) values ($1, $2)', [id, label]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ status: 'error', error: `Area '${id}' already exists.` });
    throw err;
  }
  await logAudit(pool, { actorType: 'master', actorKey: req.session.scopeKey, action: 'area.create', summary: `Created area ${id} - ${label}` });
  res.json({ status: 'ok' });
});

// Also the reactivate endpoint — {active: true} on a deactivated area is
// the only way back, no separate "restore" route (see design spec).
masterOutletsRouter.patch('/areas/:id', requireAuth, requireMaster, async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query('select id, label, active from areas where id = $1', [id]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ status: 'error', error: 'Area not found.' });

  const label = req.body.label !== undefined ? req.body.label.toString().trim() : existing.label;
  const active = req.body.active !== undefined ? !!req.body.active : existing.active;

  if (active === false && existing.active === true) {
    const { rows: activeOutlets } = await pool.query('select code from store_outlets where area_id = $1 and active', [id]);
    if (activeOutlets.length) {
      return res.status(400).json({ status: 'error', error: `Deactivate or reassign this area's ${activeOutlets.length} active outlet(s) first.` });
    }
  }

  await pool.query('update areas set label = $1, active = $2 where id = $3', [label, active, id]);
  await logAudit(pool, { actorType: 'master', actorKey: req.session.scopeKey, action: 'area.update', summary: `Updated area ${id}: label='${label}', active=${active}` });
  res.json({ status: 'ok' });
});

masterOutletsRouter.post('/', requireAuth, requireMaster, async (req, res) => {
  const code = (req.body.code || '').toString().trim();
  const division = (req.body.division || '').toString().trim();
  const areaId = req.body.areaId ? req.body.areaId.toString().trim() : null;

  if (!code || !['retail', 'warehouse'].includes(division)) {
    return res.status(400).json({ status: 'error', error: 'Outlet code and a valid division (retail/warehouse) are required.' });
  }
  if (division === 'retail' && !areaId) {
    return res.status(400).json({ status: 'error', error: 'Retail outlets must belong to an area.' });
  }
  if (division === 'warehouse' && areaId) {
    return res.status(400).json({ status: 'error', error: 'Warehouse locations cannot belong to an area.' });
  }
  if (areaId) {
    const { rows } = await pool.query('select id from areas where id = $1', [areaId]);
    if (!rows.length) return res.status(400).json({ status: 'error', error: 'Unknown area.' });
  }

  try {
    await pool.query('insert into store_outlets (code, division, area_id) values ($1, $2, $3)', [code, division, areaId]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ status: 'error', error: `Outlet '${code}' already exists.` });
    throw err;
  }
  await logAudit(pool, { actorType: 'master', actorKey: req.session.scopeKey, action: 'outlet.create', summary: `Created outlet ${code} (${division}${areaId ? ', area ' + areaId : ''})` });
  res.json({ status: 'ok' });
});

// {active: true|false} — covers both deactivate and reactivate, no rename
// (see Global Constraints: store_outlets.code is referenced by free text
// elsewhere, renaming it would silently break those joins).
masterOutletsRouter.patch('/:code', requireAuth, requireMaster, async (req, res) => {
  const code = req.params.code;
  const { rows } = await pool.query('select code, active from store_outlets where code = $1', [code]);
  if (!rows[0]) return res.status(404).json({ status: 'error', error: 'Outlet not found.' });
  const active = req.body.active !== undefined ? !!req.body.active : rows[0].active;

  await pool.query('update store_outlets set active = $1 where code = $2', [active, code]);
  await logAudit(pool, {
    actorType: 'master',
    actorKey: req.session.scopeKey,
    action: active ? 'outlet.reactivate' : 'outlet.deactivate',
    summary: `${active ? 'Reactivated' : 'Deactivated'} outlet ${code}`,
  });
  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Mount in `index.js`**

Add the import (after the `outletsRouter, areasRouter` import from Task 2):

```js
import { masterOutletsRouter } from './routes/masterOutlets.js';
```

Add the mount line (grouped with the other `/master/*` mounts, after `app.use('/master/impersonate', masterImpersonateRouter);`):

```js
app.use('/master/outlets', masterOutletsRouter);
```

- [ ] **Step 3: Verify with curl**

First get a Master token (replace with real dev credentials):
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<dev-master-username>","password":"<dev-master-password>"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
```

```bash
# Create a test area, confirm it appears
curl -s -X POST http://localhost:3000/master/outlets/areas -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"id":"R99","label":"TEST"}'
curl -s http://localhost:3000/master/outlets -H "Authorization: Bearer $TOKEN" | grep -o '"R99"'

# Duplicate area -> 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/master/outlets/areas -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"id":"R99","label":"TEST"}'

# Create an outlet in it, confirm public GET /outlets picks it up
curl -s -X POST http://localhost:3000/master/outlets -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"code":"ZZTEST","division":"retail","areaId":"R99"}'
curl -s http://localhost:3000/outlets | grep -o '"ZZTEST"'

# Deactivating the area while it has an active outlet -> blocked
curl -s -X PATCH http://localhost:3000/master/outlets/areas/R99 -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"active":false}'

# Deactivate the outlet, confirm it drops out of the public list
curl -s -X PATCH http://localhost:3000/master/outlets/ZZTEST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"active":false}'
curl -s http://localhost:3000/outlets | grep -o '"ZZTEST"'

# Now the area can deactivate
curl -s -X PATCH http://localhost:3000/master/outlets/areas/R99 -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"active":false}'

# No auth -> 401/403
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/master/outlets/areas -H "Content-Type: application/json" -d '{"id":"R98","label":"X"}'
```
Expected: create succeeds (`{"status":"ok"}`), duplicate returns `409`, the outlet appears in the public list right after creation, the area-deactivate-while-active-outlet-exists call returns `400`, deactivating the outlet removes it from the public list, the area then deactivates successfully, and the unauthenticated call returns `401`.

- [ ] **Step 4: Clean up test rows**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from store_outlets where code = 'ZZTEST'\");
  await pool.query(\"delete from areas where id = 'R99'\");
  await pool.end();
});
"
```

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add src/routes/masterOutlets.js src/index.js
git commit -m "feat: add Master-only outlet/area CRUD endpoints"
```

---

## Task 4: Backend — refactor `auth.js` to query the DB instead of `config/areas.js`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\auth.js:6,79,143`

**Interfaces:**
- Consumes: `pool` from `../config/db.js` (already imported in this file).
- Produces: an inline `areaExists(areaId)` async check, replacing the `outletsForArea` import — used the same way at both existing call sites.

- [ ] **Step 1: Replace the import**

Change `auth.js:6`:
```js
import { outletsForArea } from '../config/areas.js';
```
to:
```js
async function areaExists(areaId) {
  const { rows } = await pool.query('select 1 from areas where id = $1 and active', [areaId]);
  return rows.length > 0;
}
```

- [ ] **Step 2: Update the `manager-login` call site (`auth.js:79`)**

Change:
```js
if (!areaId || !outletsForArea(areaId)) {
```
to:
```js
if (!areaId || !(await areaExists(areaId))) {
```

- [ ] **Step 3: Update the `manager-register` call site (`auth.js:143`)**

Same change as Step 2, applied to the second occurrence in `manager-register`.

- [ ] **Step 4: Verify with curl**

Run: `cd lautan-academy-backend && npm run dev`

```bash
# Valid area (R1, seeded in Task 1) -> reaches the PIN check, not the "Select a valid area" error
curl -s -X POST http://localhost:3000/auth/manager-login -H "Content-Type: application/json" -d '{"role":"area_manager","outlet":"R1","pin":"0000"}'
# Unknown area -> explicit error
curl -s -X POST http://localhost:3000/auth/manager-login -H "Content-Type: application/json" -d '{"role":"area_manager","outlet":"NOPE","pin":"0000"}'
```
Expected: first call returns `{"authorized":false,"error":"Incorrect password."}` (proves it passed the area check and hit the PIN check); second returns `{"authorized":false,"error":"Select a valid area."}`.

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add src/routes/auth.js
git commit -m "refactor: auth.js area validation reads from areas table, not config/areas.js"
```

---

## Task 5: Backend — refactor `reports.js` + `data.js`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\reports.js:4,25`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\data.js:4,63`

**Interfaces:**
- Consumes: `pool` (already imported in both files).
- Produces: an inline `outletsForArea(areaId)` async helper in each file (small, file-local — matches this codebase's existing "local duplication over shared utility" convention, see `masterSessions.js`'s comment on `withTransaction`), replacing the `config/areas.js` import.

- [ ] **Step 1: `reports.js` — replace the import (line 4)**

Change:
```js
import { outletsForArea } from '../config/areas.js';
```
to:
```js
async function outletsForArea(areaId) {
  const { rows } = await pool.query('select code from store_outlets where area_id = $1 and active', [areaId]);
  return rows.map(r => r.code);
}
```

- [ ] **Step 2: `reports.js` — update the call site (line 25)**

Change:
```js
const regionOutlets = outletsForArea(req.session.scopeKey) || [];
```
to:
```js
const regionOutlets = await outletsForArea(req.session.scopeKey);
```

- [ ] **Step 3: `data.js` — replace the import (line 4)**

Change:
```js
import { outletsForArea } from '../config/areas.js';
```
to:
```js
async function outletsForArea(areaId) {
  const { rows } = await pool.query('select code from store_outlets where area_id = $1 and active', [areaId]);
  return rows.map(r => r.code);
}
```

- [ ] **Step 4: `data.js` — update the call site (line 63)**

Change:
```js
const outlets = outletsForArea(scopeKey) || [];
```
to:
```js
const outlets = await outletsForArea(scopeKey);
```

- [ ] **Step 5: Verify with curl**

Log in as an area manager first (using a real seeded area + its registered password, or the shared `manager_pins` PIN if no per-area password is registered yet), then:

```bash
AREA_TOKEN="<paste the token from the manager-login response>"
curl -s http://localhost:3000/data/scoped-data -H "Authorization: Bearer $AREA_TOKEN" | head -c 300
```
Expected: 200 response with `results`/`wrong`/`reports` arrays scoped to that area's outlets (empty arrays are fine if the area has no data yet — the point is no 500 error and the DB-backed outlet list resolved).

- [ ] **Step 6: Commit**

```bash
cd lautan-academy-backend
git add src/routes/reports.js src/routes/data.js
git commit -m "refactor: reports.js and data.js area scoping reads from store_outlets table"
```

---

## Task 6: Backend — refactor `masterImpersonate.js`, delete backend `config/areas.js`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\masterImpersonate.js:5,17-21,43,45,47`
- Delete: `C:\Users\Hafiz\projects\lautan-academy-backend\src\config\areas.js`

**Interfaces:**
- Consumes: `pool` (already imported).
- Produces: async `isValidOutlet(scopeType, code)` / `areaExists(areaId)` checks replacing the module-level `RETAIL_OUTLETS`/`WAREHOUSE_LOCATIONS` sets and the `outletsForArea` import.

- [ ] **Step 1: Replace the import and constants (lines 5, 17-21)**

Change:
```js
import { outletsForArea, AREAS } from '../config/areas.js';
```
to:
```js
```
(remove the line entirely)

Change:
```js
const RETAIL_OUTLETS = new Set(AREAS.flatMap((a) => a.outlets));
// Local duplication, not a shared constant — matches this codebase's
// existing per-file convention for this exact list.
const WAREHOUSE_LOCATIONS = new Set(['Taskforce', 'Warehouse', 'Inventory', 'Logistic']);
```
to:
```js
async function isValidOutlet(division, code) {
  const { rows } = await pool.query(
    'select 1 from store_outlets where code = $1 and division = $2 and active',
    [code, division]
  );
  return rows.length > 0;
}
async function areaExists(areaId) {
  const { rows } = await pool.query('select 1 from areas where id = $1 and active', [areaId]);
  return rows.length > 0;
}
```

- [ ] **Step 2: Update the three validation call sites (lines 43, 45, 47)**

Change:
```js
  } else if (scopeType === 'outlet_manager') {
    if (!RETAIL_OUTLETS.has(scopeKey)) return res.status(400).json({ authorized: false, error: 'Unknown outlet.' });
  } else if (scopeType === 'warehouse_manager') {
    if (!WAREHOUSE_LOCATIONS.has(scopeKey)) return res.status(400).json({ authorized: false, error: 'Unknown location.' });
  } else if (scopeType === 'area_manager') {
    if (!outletsForArea(scopeKey)) return res.status(400).json({ authorized: false, error: 'Unknown area.' });
  }
```
to:
```js
  } else if (scopeType === 'outlet_manager') {
    if (!(await isValidOutlet('retail', scopeKey))) return res.status(400).json({ authorized: false, error: 'Unknown outlet.' });
  } else if (scopeType === 'warehouse_manager') {
    if (!(await isValidOutlet('warehouse', scopeKey))) return res.status(400).json({ authorized: false, error: 'Unknown location.' });
  } else if (scopeType === 'area_manager') {
    if (!(await areaExists(scopeKey))) return res.status(400).json({ authorized: false, error: 'Unknown area.' });
  }
```

- [ ] **Step 3: Delete backend `config/areas.js` and confirm nothing else imports it**

```bash
cd lautan-academy-backend
rm src/config/areas.js
```

Run: `grep -rn "config/areas" src/`
Expected: no output (Tasks 4-6 already removed the only three importers).

- [ ] **Step 4: Verify with curl**

Using the Master token from Task 3:
```bash
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"scopeType":"outlet_manager","scopeKey":"DG"}'
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"scopeType":"outlet_manager","scopeKey":"NOTREAL"}'
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"scopeType":"area_manager","scopeKey":"R1"}'
```
Expected: first and third calls return `{"authorized":true,"token":"..."}`; second returns `400` with `"Unknown outlet."`.

- [ ] **Step 5: Restart the backend and confirm it boots clean**

Run: `cd lautan-academy-backend && npm run dev`
Expected: no import errors, `lautan-academy-backend listening on :3000`.

- [ ] **Step 6: Commit**

```bash
cd lautan-academy-backend
git add -A src/routes/masterImpersonate.js src/config/areas.js
git commit -m "refactor: masterImpersonate.js validates against outlets/areas tables; delete unused config/areas.js"
```

---

## Task 7: Frontend — `api/client.js` entries + `useOutlets()` composable

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\api\client.js`
- Create: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\composables\useOutlets.js`

**Interfaces:**
- Consumes: `request()`/`api` pattern already in `client.js`; `masterAuth.token` shape used by every other `master*` API call.
- Produces: `api.getOutlets()`, `api.getAreas()`, `api.masterGetOutlets(masterToken)`, `api.masterCreateArea(payload, masterToken)`, `api.masterUpdateArea(id, payload, masterToken)`, `api.masterCreateOutlet(payload, masterToken)`, `api.masterUpdateOutlet(code, payload, masterToken)`. `useOutlets()` composable exposing `{ retailOutlets, warehouseLocations, allOutletCodes, areas, areaIds, loading, error, outletsForArea, reload }` — consumed by Tasks 8-11.

- [ ] **Step 1: Add API methods to `client.js`**

Add after the existing `getQuestions: () => request('/questions'),` line:

```js
  getOutlets: (division) => request(`/outlets${division ? `?division=${encodeURIComponent(division)}` : ''}`),
  getAreas: () => request('/areas'),
  masterGetOutlets: (masterToken) =>
    request('/master/outlets', { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterCreateArea: (payload, masterToken) =>
    request('/master/outlets/areas', { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterUpdateArea: (id, payload, masterToken) =>
    request(`/master/outlets/areas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterCreateOutlet: (payload, masterToken) =>
    request('/master/outlets', { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterUpdateOutlet: (code, payload, masterToken) =>
    request(`/master/outlets/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
```

- [ ] **Step 2: Write `composables/useOutlets.js`**

```js
import { ref, computed } from 'vue'
import { api } from '../api/client'

// Replaces the OUTLET_LIST / WAREHOUSE_LOCATIONS / AREAS arrays previously
// hardcoded in ~10 files. Fetches once per call site — the whole table is
// ~60 rows, cheap enough that no shared cache/store is worth the added
// complexity (YAGNI). See
// docs/superpowers/specs/2026-08-11-outlet-management-design.md.
export function useOutlets() {
  const retailOutlets = ref([])
  const warehouseLocations = ref([])
  const areas = ref([])
  const loading = ref(true)
  const error = ref('')

  const allOutletCodes = computed(() => [...retailOutlets.value].sort().concat(warehouseLocations.value))
  const areaIds = computed(() => areas.value.map((a) => a.id))

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const [outletsData, areasData] = await Promise.all([api.getOutlets(), api.getAreas()])
      retailOutlets.value = outletsData.outlets.filter((o) => o.division === 'retail').map((o) => o.code).sort()
      warehouseLocations.value = outletsData.outlets.filter((o) => o.division === 'warehouse').map((o) => o.code)
      areas.value = areasData.areas
    } catch (e) {
      error.value = e.message || 'Could not load outlets.'
    } finally {
      loading.value = false
    }
  }

  function outletsForArea(areaId) {
    return areas.value.find((a) => a.id === areaId)?.outlets || []
  }

  load()

  return { retailOutlets, warehouseLocations, allOutletCodes, areas, areaIds, loading, error, outletsForArea, reload: load }
}
```

- [ ] **Step 3: Build check**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build (nothing consumes the new composable/API methods yet, so this only confirms no syntax errors).

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-frontend
git add src/api/client.js src/composables/useOutlets.js
git commit -m "feat: add outlets/areas API methods and useOutlets composable"
```

---

## Task 8: Frontend — refactor `LoginView.vue`, `ManagerLoginView.vue`, `ManagerRegisterView.vue`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\LoginView.vue:14-20,33`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\ManagerLoginView.vue:17-18,28`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\ManagerRegisterView.vue:16-17,29`

**Interfaces:**
- Consumes: `useOutlets()` from Task 7 (`../composables/useOutlets`).
- Produces: unchanged `outletOptions` computed in all three files — only its data source changes, so the template (`v-for="o in outletOptions"`) needs no edits.

- [ ] **Step 1: `LoginView.vue`**

Change (lines 14-20):
```js
// Static outlet list — same 49 codes hardcoded in the vanilla-JS app
// (index.html's `outletList`). Not fetched from the backend; there's no
// "outlets" table backing the real system, outlets are just codes.
const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];
// Warehouse division picks a location instead of a retail outlet code —
// same 4 fixed values as the vanilla app's wh-staff-location select.
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
const { retailOutlets: OUTLET_LIST, warehouseLocations: WAREHOUSE_LOCATIONS } = useOutlets()
```
(add the `import` line up with the other imports at the top of the `<script setup>` block, not inline where the old constant was — the destructure line stays where the constant used to be)

Line 33's `outletOptions` computed is unchanged — `OUTLET_LIST`/`WAREHOUSE_LOCATIONS` are now refs, and Vue's `computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS : OUTLET_LIST)` auto-unwraps refs used inside `<template>` but **not** inside a `computed()` callback in `<script>` — update it to:
```js
const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS.value : OUTLET_LIST.value)
```

- [ ] **Step 2: `ManagerLoginView.vue`**

Change (lines 17-18):
```js
const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
const { retailOutlets: OUTLET_LIST, warehouseLocations: WAREHOUSE_LOCATIONS } = useOutlets()
```
(the `import` line goes up with the file's other imports; the destructure line stays where the constants used to be)

Change line 28's `outletOptions` computed:
```js
const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS : OUTLET_LIST)
```
to:
```js
const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS.value : OUTLET_LIST.value)
```

- [ ] **Step 3: `ManagerRegisterView.vue`**

Change (lines 16-17), same constants and same replacement as Step 2:
```js
const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
const { retailOutlets: OUTLET_LIST, warehouseLocations: WAREHOUSE_LOCATIONS } = useOutlets()
```

Change line 29's `outletOptions` computed:
```js
const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS : OUTLET_LIST)
```
to:
```js
const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS.value : OUTLET_LIST.value)
```

- [ ] **Step 4: Build check**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build.

- [ ] **Step 5: Manual browser verification**

Run: `cd lautan-academy-backend && npm run dev` (separate terminal) and `cd lautan-academy-frontend && npm run dev`
- Open the staff login page (`/login`) — confirm the outlet dropdown lists the same 49 codes as before, and switching to Warehouse shows the 4 locations.
- Open `/manager-login` and `/manager-register` — same check.

- [ ] **Step 6: Commit**

```bash
cd lautan-academy-frontend
git add src/views/LoginView.vue src/views/ManagerLoginView.vue src/views/ManagerRegisterView.vue
git commit -m "refactor: staff/manager login and register views read outlets from useOutlets composable"
```

---

## Task 9: Frontend — refactor `AreaManagerLoginView.vue`, `AreaManagerRegisterView.vue`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\AreaManagerLoginView.vue:13,38,70`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\AreaManagerRegisterView.vue:9,44,76`

**Interfaces:**
- Consumes: `useOutlets()` from Task 7.
- Produces: `AREAS`/`outletsForArea` replaced with the composable's `areas`/`outletsForArea`; the area dropdown now displays `${id} - ${label}` instead of the old combined `a.id` string (Task 1's seed split `"R1 - AMIRUL"` into `id: 'R1', label: 'AMIRUL'`).

- [ ] **Step 1: `AreaManagerLoginView.vue` — replace the import (line 13)**

Change:
```js
import { AREAS, outletsForArea } from '../config/areas'
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```
and add, alongside the other `const ... = ref('')` declarations:
```js
const { areas: AREAS, outletsForArea } = useOutlets()
```

- [ ] **Step 2: `AreaManagerLoginView.vue` — update the submit call site (line 38)**

`outletsForArea` is still a plain function (not a ref) per the composable's design, so this call site is unchanged:
```js
await auth.loginManager('area_manager', areaId.value, pin.value.trim(), areaId.value, outletsForArea(areaId.value))
```
No edit needed here — leave as-is. (Note only, not a code step: this confirms the composable's function-not-ref choice for `outletsForArea` was deliberate, matching the old `config/areas.js` export's call shape exactly.)

- [ ] **Step 3: `AreaManagerLoginView.vue` — update the template (line 70)**

Change:
```html
<option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
```
to:
```html
<option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
```
(`AREAS` is a ref now, but templates auto-unwrap top-level refs — `v-for="a in AREAS"` needs no `.value`)

- [ ] **Step 4: `AreaManagerRegisterView.vue` — replace the import (line 9)**

Change:
```js
import { AREAS, outletsForArea } from '../config/areas'
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```
and add, alongside the other `const ... = ref('')` declarations:
```js
const { areas: AREAS, outletsForArea } = useOutlets()
```

- [ ] **Step 5: `AreaManagerRegisterView.vue` — submit call site (line 44)**

`outletsForArea` is still a plain function, not a ref — this call site is unchanged:
```js
await auth.registerManager('area_manager', areaId.value, masterPin.value.trim(), newPassword.value, areaId.value, outletsForArea(areaId.value))
```
No edit needed. (Note only, same reasoning as the login view's Step 2.)

- [ ] **Step 6: `AreaManagerRegisterView.vue` — update the template (line 76)**

Change:
```html
<option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
```
to:
```html
<option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
```

- [ ] **Step 7: Build check**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build.

- [ ] **Step 8: Manual browser verification**

- Open `/area-manager-login` — confirm the area dropdown shows all 9 areas as `"R1 - AMIRUL"` through `"R9 - IFFAH / RAIHAN"` (same text as before the refactor, now assembled from two DB fields instead of one hardcoded string).
- Open `/area-manager-register` — same check.

- [ ] **Step 9: Commit**

```bash
cd lautan-academy-frontend
git add src/views/AreaManagerLoginView.vue src/views/AreaManagerRegisterView.vue
git commit -m "refactor: area manager login/register views read areas from useOutlets composable"
```

---

## Task 10: Frontend — refactor the 6 Master admin panels, delete frontend `config/areas.js`

**Discovered during execution:** the original file grep this task was scoped from only matched files that redeclared their own `OUTLET_LIST`/`WAREHOUSE_LOCATIONS`/`AREAS =` constants, which missed 4 more real importers that consume `AREAS`/`outletsForArea` directly without a local re-declaration: `PurgeReportsContentPanel.vue`, `SupervisorDashboard.vue`, `SupervisorReportsView.vue`, `SupervisorStaffComparisonView.vue`. All 4 got the same composable swap as the 6 files below before `config/areas.js` was deleted, confirmed via `grep -rn "config/areas" src/` returning zero real (non-comment) importers.

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterImpersonation.vue:12,19-21,34-36`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterActiveSessions.vue:11,21-23,33-35`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterAuditLog.vue:18-20,26-28`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\PurgeManagerAccountsPanel.vue:6,16-18,24-26`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\PurgeQuizAttemptsPanel.vue:6,15-16`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\PurgeStaffPanel.vue:6,14-15`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\PurgeReportsContentPanel.vue` (retail-only `OUTLET_OPTIONS`, same swap as the outlet-code constants below)
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\SupervisorDashboard.vue`, `SupervisorReportsView.vue`, `SupervisorStaffComparisonView.vue` (each imports `AREAS, outletsForArea` for a region filter dropdown + region-to-outlets lookup; same swap as Task 9's area manager views, including the `{{ a.id }} - {{ a.label }}` display fix)
- Delete: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\config\areas.js`

**Interfaces:**
- Consumes: `useOutlets()` from Task 7.
- Produces: every `RETAIL_OUTLETS`/`WAREHOUSE_LOCATIONS`/`AREA_IDS`/`OUTLET_OPTIONS`/`AREAS`/`outletsForArea` reference across these 10 files becomes composable-backed, same names kept as local bindings so every downstream `computed()`/template reference is untouched.

- [ ] **Step 1: `MasterImpersonation.vue`**

Change (lines 12, 19-21):
```js
import { AREAS } from '../config/areas'
```
```js
const RETAIL_OUTLETS = [...new Set(AREAS.flatMap(a => a.outlets))].sort()
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const AREA_IDS = AREAS.map(a => a.id)
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```
```js
const { retailOutlets: RETAIL_OUTLETS, warehouseLocations: WAREHOUSE_LOCATIONS, areaIds: AREA_IDS } = useOutlets()
```

Update the computed at lines 34-36 to unwrap the now-ref constants:
```js
const outletOptions = computed(() => {
  if (targetType.value === 'staff_warehouse' || targetType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS.value
  if (targetType.value === 'area_manager') return AREA_IDS.value
  return RETAIL_OUTLETS.value
})
```

- [ ] **Step 2: `MasterActiveSessions.vue`**

Change (line 11):
```js
import { AREAS } from '../config/areas'
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```

Change (lines 21-23):
```js
const RETAIL_OUTLETS = [...new Set(AREAS.flatMap(a => a.outlets))].sort()
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const AREA_IDS = AREAS.map(a => a.id)
```
to:
```js
const { retailOutlets: RETAIL_OUTLETS, warehouseLocations: WAREHOUSE_LOCATIONS, areaIds: AREA_IDS } = useOutlets()
```

Change the computed (lines 33-35):
```js
const scopeKeyOptions = computed(() => {
  if (scopeType.value === 'outlet_manager') return RETAIL_OUTLETS
  if (scopeType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS
  if (scopeType.value === 'area_manager') return AREA_IDS
  return null
})
```
to:
```js
const scopeKeyOptions = computed(() => {
  if (scopeType.value === 'outlet_manager') return RETAIL_OUTLETS.value
  if (scopeType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS.value
  if (scopeType.value === 'area_manager') return AREA_IDS.value
  return null
})
```

- [ ] **Step 3: `MasterAuditLog.vue`**

Change (line 6):
```js
import { AREAS } from '../config/areas'
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```

Change (lines 18-20):
```js
const RETAIL_OUTLETS = [...new Set(AREAS.flatMap(a => a.outlets))].sort()
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const AREA_IDS = AREAS.map(a => a.id)
```
to:
```js
const { retailOutlets: RETAIL_OUTLETS, warehouseLocations: WAREHOUSE_LOCATIONS, areaIds: AREA_IDS } = useOutlets()
```

Change the computed (lines 26-28, note this file's version returns `null` as its default like `MasterActiveSessions.vue`, keep that line unchanged):
```js
const actorKeyOptions = computed(() => {
  if (actorType.value === 'outlet_manager') return RETAIL_OUTLETS
  if (actorType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS
  if (actorType.value === 'area_manager') return AREA_IDS
  return null
})
```
to:
```js
const actorKeyOptions = computed(() => {
  if (actorType.value === 'outlet_manager') return RETAIL_OUTLETS.value
  if (actorType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS.value
  if (actorType.value === 'area_manager') return AREA_IDS.value
  return null
})
```

- [ ] **Step 4: `PurgeManagerAccountsPanel.vue`**

Change (line 6):
```js
import { AREAS } from '../config/areas'
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```

Change (lines 16-18):
```js
const RETAIL_OUTLETS = [...new Set(AREAS.flatMap(a => a.outlets))].sort()
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const AREA_IDS = AREAS.map(a => a.id)
```
to:
```js
const { retailOutlets: RETAIL_OUTLETS, warehouseLocations: WAREHOUSE_LOCATIONS, areaIds: AREA_IDS } = useOutlets()
```

Change the computed (lines 24-26):
```js
const scopeKeyOptions = computed(() => {
  if (roleFilter.value === 'outlet_manager') return RETAIL_OUTLETS
  if (roleFilter.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS
  if (roleFilter.value === 'area_manager') return AREA_IDS
  return null
})
```
to:
```js
const scopeKeyOptions = computed(() => {
  if (roleFilter.value === 'outlet_manager') return RETAIL_OUTLETS.value
  if (roleFilter.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS.value
  if (roleFilter.value === 'area_manager') return AREA_IDS.value
  return null
})
```

- [ ] **Step 5: `PurgeQuizAttemptsPanel.vue`**

Change (lines 6, 15-16):
```js
import { AREAS } from '../config/areas'
```
```js
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const OUTLET_OPTIONS = [...new Set(AREAS.flatMap(a => a.outlets))].sort().concat(WAREHOUSE_LOCATIONS)
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```
```js
const { allOutletCodes: OUTLET_OPTIONS } = useOutlets()
```
Template reference `v-for="o in OUTLET_OPTIONS"` (line 106) needs no change — `OUTLET_OPTIONS` is a ref, templates auto-unwrap it.

- [ ] **Step 6: `PurgeStaffPanel.vue`**

Change (lines 6, 14-15):
```js
import { AREAS } from '../config/areas'
```
```js
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const OUTLET_OPTIONS = [...new Set(AREAS.flatMap(a => a.outlets))].sort().concat(WAREHOUSE_LOCATIONS)
```
to:
```js
import { useOutlets } from '../composables/useOutlets'
```
```js
const { allOutletCodes: OUTLET_OPTIONS } = useOutlets()
```
Template reference `v-for="o in OUTLET_OPTIONS"` (line 96) needs no change — `OUTLET_OPTIONS` is a ref, templates auto-unwrap it.

- [ ] **Step 7: Delete frontend `config/areas.js` and confirm nothing else imports it**

```bash
cd lautan-academy-frontend
rm src/config/areas.js
```

Run: `grep -rn "config/areas" src/`
Expected: no output (Tasks 8-10 already removed every importer).

- [ ] **Step 8: Build check**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build, no unresolved-import errors.

- [ ] **Step 9: Manual browser verification**

As Master, open the Control Panel and click through View As, Active Sessions, Audit Logs, and each of the three Purge panels — confirm every outlet/warehouse/area filter dropdown still populates with the same values as before (49 retail codes, 4 warehouse locations, 9 area ids).

- [ ] **Step 10: Commit**

```bash
cd lautan-academy-frontend
git add -A src/components/MasterImpersonation.vue src/components/MasterActiveSessions.vue src/components/MasterAuditLog.vue src/components/PurgeManagerAccountsPanel.vue src/components/PurgeQuizAttemptsPanel.vue src/components/PurgeStaffPanel.vue src/config/areas.js
git commit -m "refactor: Master admin panels read outlet/area filters from useOutlets composable; delete unused config/areas.js"
```

---

## Task 11: Frontend — `MasterOutletsPanel.vue` + wire into `MasterPanel.vue` + i18n

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterOutletsPanel.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterPanel.vue:6,10,17-21,34,46`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\en.json`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\ms.json`

**Interfaces:**
- Consumes: `api.masterGetOutlets/masterCreateArea/masterUpdateArea/masterCreateOutlet/masterUpdateOutlet` (Task 7), `useMasterAuthStore` (existing), `MasterDeleteConfirmModal` is NOT used here (no bulk-delete — this panel only ever toggles `active`, matching the "no hard delete" constraint, so the higher-ceremony typed-confirm modal reserved for destructive bulk actions doesn't apply).
- Produces: `MasterOutletsPanel.vue`, emitting `close` like every other Master panel component.

- [ ] **Step 1: Write `MasterOutletsPanel.vue`**

```vue
<script setup>
// Master-only: add/deactivate/reactivate areas and outlets. No bulk-delete
// modal here — every mutation is a single-row create or active-toggle
// (see Global Constraints: no hard delete, no rename). See
// docs/superpowers/specs/2026-08-11-outlet-management-design.md.
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const areas = ref([])
const outlets = ref([])
const loading = ref(true)
const loadError = ref('')
const status = ref('')
const statusOk = ref(false)

const newAreaId = ref('')
const newAreaLabel = ref('')
const addingArea = ref(false)

const newOutletCode = ref('')
const newOutletDivision = ref('retail')
const newOutletAreaId = ref('')
const addingOutlet = ref(false)

const warehouseOutlets = computed(() => outlets.value.filter((o) => o.division === 'warehouse'))
const outletsByArea = computed(() => {
  const map = {}
  for (const a of areas.value) map[a.id] = []
  for (const o of outlets.value) {
    if (o.division === 'retail' && o.areaId) (map[o.areaId] ||= []).push(o)
  }
  return map
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api.masterGetOutlets(masterAuth.token)
    areas.value = data.areas
    outlets.value = data.outlets
  } catch (err) {
    loadError.value = err.message || t('masterPanel.outlets.errorLoadFailed')
  } finally {
    loading.value = false
  }
}

async function addArea() {
  if (!newAreaId.value.trim() || !newAreaLabel.value.trim()) return
  addingArea.value = true
  status.value = ''
  try {
    await api.masterCreateArea({ id: newAreaId.value.trim(), label: newAreaLabel.value.trim() }, masterAuth.token)
    status.value = t('masterPanel.outlets.successAreaAdded', { id: newAreaId.value.trim() })
    statusOk.value = true
    newAreaId.value = ''
    newAreaLabel.value = ''
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorAddFailed')
    statusOk.value = false
  } finally {
    addingArea.value = false
  }
}

async function addOutlet() {
  if (!newOutletCode.value.trim()) return
  if (newOutletDivision.value === 'retail' && !newOutletAreaId.value) return
  addingOutlet.value = true
  status.value = ''
  try {
    await api.masterCreateOutlet(
      {
        code: newOutletCode.value.trim(),
        division: newOutletDivision.value,
        areaId: newOutletDivision.value === 'retail' ? newOutletAreaId.value : null,
      },
      masterAuth.token
    )
    status.value = t('masterPanel.outlets.successOutletAdded', { code: newOutletCode.value.trim() })
    statusOk.value = true
    newOutletCode.value = ''
    newOutletAreaId.value = ''
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorAddFailed')
    statusOk.value = false
  } finally {
    addingOutlet.value = false
  }
}

async function toggleOutlet(outlet) {
  status.value = ''
  try {
    await api.masterUpdateOutlet(outlet.code, { active: !outlet.active }, masterAuth.token)
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorUpdateFailed')
    statusOk.value = false
  }
}

async function toggleArea(area) {
  status.value = ''
  try {
    await api.masterUpdateArea(area.id, { active: !area.active }, masterAuth.token)
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorUpdateFailed')
    statusOk.value = false
  }
}

load()
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.outlets.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.outlets.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.outlets.intro') }}</p>
    </div>

    <p v-if="loadError" class="text-coral text-xs">{{ loadError }}</p>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <div v-if="!loading" class="space-y-3">
      <div v-for="area in areas" :key="area.id" class="border border-seafoam rounded-lg p-3" :class="!area.active && 'opacity-50'">
        <div class="flex items-center justify-between">
          <span class="font-medium text-ink text-sm">{{ area.id }} - {{ area.label }}</span>
          <button type="button" @click="toggleArea(area)" class="text-xs font-medium hover:underline" :class="area.active ? 'text-coral' : 'text-aqua'">
            {{ area.active ? t('masterPanel.outlets.deactivate') : t('masterPanel.outlets.reactivate') }}
          </button>
        </div>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li v-for="o in outletsByArea[area.id]" :key="o.code" class="text-xs px-2 py-1 rounded border border-slate/30" :class="!o.active && 'opacity-50 line-through'">
            {{ o.code }}
            <button type="button" @click="toggleOutlet(o)" class="ml-1 hover:underline" :class="o.active ? 'text-coral' : 'text-aqua'">
              {{ o.active ? t('masterPanel.outlets.deactivate') : t('masterPanel.outlets.reactivate') }}
            </button>
          </li>
        </ul>
      </div>

      <div class="border border-seafoam rounded-lg p-3">
        <span class="font-medium text-ink text-sm">{{ t('masterPanel.outlets.warehouseSection') }}</span>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li v-for="o in warehouseOutlets" :key="o.code" class="text-xs px-2 py-1 rounded border border-slate/30" :class="!o.active && 'opacity-50 line-through'">
            {{ o.code }}
            <button type="button" @click="toggleOutlet(o)" class="ml-1 hover:underline" :class="o.active ? 'text-coral' : 'text-aqua'">
              {{ o.active ? t('masterPanel.outlets.deactivate') : t('masterPanel.outlets.reactivate') }}
            </button>
          </li>
        </ul>
      </div>

      <form @submit.prevent="addArea" class="border border-seafoam rounded-lg p-3 space-y-2">
        <span class="font-medium text-ink text-sm">{{ t('masterPanel.outlets.addArea') }}</span>
        <div class="flex gap-2">
          <input v-model="newAreaId" :placeholder="t('masterPanel.outlets.areaIdPlaceholder')" class="w-24 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
          <input v-model="newAreaLabel" :placeholder="t('masterPanel.outlets.areaLabelPlaceholder')" class="flex-1 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
          <button type="submit" :disabled="addingArea" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{{ t('masterPanel.outlets.add') }}</button>
        </div>
      </form>

      <form @submit.prevent="addOutlet" class="border border-seafoam rounded-lg p-3 space-y-2">
        <span class="font-medium text-ink text-sm">{{ t('masterPanel.outlets.addOutlet') }}</span>
        <div class="flex flex-wrap gap-2">
          <input v-model="newOutletCode" :placeholder="t('masterPanel.outlets.outletCodePlaceholder')" class="w-28 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
          <select v-model="newOutletDivision" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
            <option value="retail">{{ t('masterPanel.outlets.divisionRetail') }}</option>
            <option value="warehouse">{{ t('masterPanel.outlets.divisionWarehouse') }}</option>
          </select>
          <select v-if="newOutletDivision === 'retail'" v-model="newOutletAreaId" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
            <option value="">{{ t('masterPanel.outlets.selectArea') }}</option>
            <option v-for="a in areas" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
          </select>
          <button type="submit" :disabled="addingOutlet" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{{ t('masterPanel.outlets.add') }}</button>
        </div>
      </form>
    </div>
    <p v-else class="text-slate text-xs">{{ t('masterPanel.outlets.loading') }}</p>
  </div>
</template>
```

- [ ] **Step 2: Wire into `MasterPanel.vue`**

Add the import (after `import MasterImpersonation from './MasterImpersonation.vue'` at line 11):
```js
import MasterOutletsPanel from './MasterOutletsPanel.vue'
```

Add `'outlets'` to both arrays (line 20-21):
```js
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation', 'outlets']
const ENABLED_TABS = ['pinReset', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation', 'outlets']
```

Add the render branch (after the `MasterImpersonation` line, line 46):
```html
<MasterOutletsPanel v-else-if="activeTab === 'outlets'" @close="activeTab = null" />
```

Add `'outlets'` to the wide-panel class list (line 34) so this panel gets the same `max-w-3xl` width as the other list/table panels:
```js
:class="['dataPurge', 'auditLogs', 'sessions', 'outlets'].includes(activeTab) ? 'max-w-3xl' : 'max-w-sm'"
```

- [ ] **Step 3: Add EN strings to `en.json`**

Add to the `masterPanel.tab` object:
```json
"outlets": "Outlets & Areas"
```

Add a new `masterPanel.outlets` object (alongside `masterPanel.sessions`, `masterPanel.auditLogs`, etc.):
```json
"outlets": {
  "back": "Back",
  "title": "Outlets & Areas",
  "intro": "Add new outlets, warehouse locations, or areas as the company grows — no code changes needed. Deactivating hides an outlet/area from login dropdowns without deleting its history.",
  "loading": "Loading...",
  "warehouseSection": "Warehouse Locations",
  "addArea": "Add Area",
  "areaIdPlaceholder": "ID (e.g. R10)",
  "areaLabelPlaceholder": "Label (e.g. manager name)",
  "addOutlet": "Add Outlet",
  "outletCodePlaceholder": "Outlet code",
  "divisionRetail": "Retail",
  "divisionWarehouse": "Warehouse",
  "selectArea": "Select area",
  "add": "Add",
  "deactivate": "Deactivate",
  "reactivate": "Reactivate",
  "successAreaAdded": "Area {id} added.",
  "successOutletAdded": "Outlet {code} added.",
  "errorLoadFailed": "Could not load outlets.",
  "errorAddFailed": "Could not add.",
  "errorUpdateFailed": "Could not update."
}
```

- [ ] **Step 4: Add matching MS strings to `ms.json`**

Add to the `masterPanel.tab` object:
```json
"outlets": "Cawangan & Kawasan"
```

Add the matching `masterPanel.outlets` object with Bahasa Malaysia translations, same keys as Step 3:
```json
"outlets": {
  "back": "Kembali",
  "title": "Cawangan & Kawasan",
  "intro": "Tambah cawangan baharu, lokasi gudang, atau kawasan apabila syarikat berkembang — tiada perubahan kod diperlukan. Menyahaktifkan menyembunyikan cawangan/kawasan daripada senarai log masuk tanpa memadam sejarahnya.",
  "loading": "Memuatkan...",
  "warehouseSection": "Lokasi Gudang",
  "addArea": "Tambah Kawasan",
  "areaIdPlaceholder": "ID (cth. R10)",
  "areaLabelPlaceholder": "Label (cth. nama pengurus)",
  "addOutlet": "Tambah Cawangan",
  "outletCodePlaceholder": "Kod cawangan",
  "divisionRetail": "Runcit",
  "divisionWarehouse": "Gudang",
  "selectArea": "Pilih kawasan",
  "add": "Tambah",
  "deactivate": "Nyahaktifkan",
  "reactivate": "Aktifkan Semula",
  "successAreaAdded": "Kawasan {id} ditambah.",
  "successOutletAdded": "Cawangan {code} ditambah.",
  "errorLoadFailed": "Gagal memuatkan cawangan.",
  "errorAddFailed": "Gagal menambah.",
  "errorUpdateFailed": "Gagal mengemas kini."
}
```

- [ ] **Step 5: Build check + key-parity check**

Run: `cd lautan-academy-frontend && npm run build` — expect clean.
Run the key-parity script from the Global Constraints section — expect both arrays empty.

- [ ] **Step 6: Manual browser verification**

As Master, open the Control Panel → "Outlets & Areas" tab:
- Confirm all 9 areas list with their outlets nested, and the Warehouse Locations section shows the 4 fixed locations.
- Add a test area (e.g. `R99`/`TEST`), confirm it appears in the list and in the "Add Outlet" area dropdown.
- Add a test outlet into it, confirm it appears nested under that area.
- Immediately open `/manager-login` (or `/manager-register`) in another tab and confirm the new outlet appears in the dropdown with **no redeploy** — this is the actual feature the user asked for.
- Deactivate the test outlet, confirm it disappears from `/manager-login`'s dropdown but still shows (struck through) in the Master panel.
- Deactivate the test area — should now succeed since its only outlet is inactive.
- Reactivate both, then leave them (or clean up via the same curl pattern as Task 3 Step 4) — don't leave test data if this was run against a shared dev DB other people also use.

- [ ] **Step 7: Commit**

```bash
cd lautan-academy-frontend
git add src/components/MasterOutletsPanel.vue src/components/MasterPanel.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add Outlets & Areas Master panel tab"
```

---

## Task 12: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full build check on both sides**

```bash
cd lautan-academy-backend && npm run dev
```
Expected: boots clean, no errors, listening on port 3000.

```bash
cd lautan-academy-frontend && npm run build
```
Expected: clean build.

- [ ] **Step 2: Confirm zero leftover hardcoded copies**

```bash
grep -rn "OUTLET_LIST\s*=\s*\[\"AJ\"" lautan-academy-frontend/src lautan-academy-backend/src
grep -rn "WAREHOUSE_LOCATIONS = \['Taskforce'" lautan-academy-frontend/src lautan-academy-backend/src
grep -rn "config/areas" lautan-academy-frontend/src lautan-academy-backend/src
```
Expected: no output from any of the three — the only remaining reference to the old shape is inside `useOutlets.js`'s destructured local variable *names* (`RETAIL_OUTLETS`, `WAREHOUSE_LOCATIONS` as local `const` bindings in Task 10's files), not a hardcoded literal array or an import of the deleted config files.

- [ ] **Step 3: Full login flow click-through in a real browser**

With both dev servers running:
- Staff login (`/login`), Outlet Manager login (`/manager-login`), Warehouse Manager login (division toggle on the same page), Area Manager login (`/area-manager-login`), and the two register pages — confirm every outlet/location/area dropdown populates correctly and login/registration still works end-to-end for at least one real (non-production) test account per role.
- Master Control Panel: click through every tab (not just the new Outlets one) to confirm nothing regressed from the constant→composable swap in Task 10.

- [ ] **Step 4: Confirm the actual growth scenario works without a redeploy**

- As Master, add a brand-new outlet through the Outlets & Areas panel.
- Without restarting or rebuilding the frontend, refresh `/manager-register` and confirm the new outlet is selectable.
- Register a test manager account against it and confirm login works.
- Deactivate the test outlet and account afterward via the Master panel / Purge panels so no test data is left in a shared dev DB.

- [ ] **Step 5: No commit for this task** — it's verification only. If any step surfaces a real bug, fix it as a small follow-up commit referencing which task's code it belongs to, then re-run the affected step.

---

## Post-implementation

Update `MEMORY.md` and `SCOPE_TRACKER.md` per this project's `CLAUDE.md` rule 5: summarize the outcome, check off the item only after Task 12's verification passed (not just written), then prompt the user to `/clear` to reset token burn.
