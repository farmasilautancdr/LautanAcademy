# Master Subsystem D — Maintenance Kill-Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Master a toggle that takes the whole app offline (503) for every non-master session — staff and all 4 manager roles — with an optional custom message, while Master's own login/panel stays reachable so they can turn it back off.

**Architecture:** One new backend file (`routes/maintenance.js`, mounted at the app root) holds a public status-read route and a master-only toggle route, backed by one row in a new generic `system_settings` table. A new `checkMaintenance` middleware, applied to every existing router except `/auth` and `/master/*`, 503s with a `maintenance: true` marker when the flag is on. On the frontend, a Pinia store tracks the flag; the central `request()` helper in `api/client.js` detects the 503 marker and flips the store; a full-screen `MaintenanceOverlay.vue` renders whenever the store is active; a new Master Panel tab (`MasterMaintenance.vue`) reads/writes the flag.

**Tech Stack:** Node.js/Express/`pg` (backend), Vue 3 `<script setup>`/Pinia/`vue-i18n` (frontend). No new dependencies.

## Global Constraints

- Block scope: when maintenance is ON, every route 503s for non-master sessions **except** `/auth/*` (login still works) and `/master/*` (Master can always reach the panel to turn it back off). `GET /health` and the new `GET /maintenance-status` also stay open.
- Storage: generic `system_settings` key-value table (`key text primary key, value jsonb, updated_by text, updated_at timestamptz`), one row (`key = 'maintenance'`) for this feature — reusable by future subsystems without a new migration.
- Message: one free-text field, wrapped in fixed bilingual chrome on the overlay — not two separate EN/MS inputs.
- Frontend scope: Vue app only. Vanilla `index.html` is not touched.
- Overlay recovery: manual "Try Again" button, no background polling.
- `checkMaintenance` fails open on a DB error (logs and calls `next()`) — a hiccup reading the flag must not become a second outage on top of whatever the switch was meant to guard against.
- No test framework exists in either repo. Verification is `npm run build` (frontend) + curl against a running dev server (backend) + manual browser click-through — matching every prior subsystem's convention, not a plan gap.
- Bilingual EN/MS for every user-facing string. Master Panel tab strings go under `masterPanel.maintenanceMode.*` (flat-namespace-per-view convention already used by `pinReset`/`dataPurge`). The overlay itself is not inside the panel drawer, so it gets its own top-level `maintenanceOverlay.*` namespace.
- All SQL uses parameterized queries.
- Backend repo: `C:\Users\Hafiz\projects\lautan-academy-backend`. Frontend repo: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend`. Separate git repos — commit each independently.

---

## Task 1: `system_settings` table migration

**Files:**
- Create: `lautan-academy-backend/scripts/migrate-add-system-settings.js`
- Modify: `lautan-academy-backend/sql/schema.sql`

**Interfaces:**
- Produces: table `system_settings(key text pk, value jsonb, updated_by text, updated_at timestamptz)`. Task 2 depends on this table existing.

- [ ] **Step 1: Write the migration script**

```js
// One-off: adds system_settings, a generic key-value table. First user is
// Master Subsystem D's maintenance kill-switch (key='maintenance'), but the
// shape is intentionally generic so future Master subsystems can reuse it
// without another migration. See
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md. Safe to re-run.
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`
    create table if not exists system_settings (
      key text primary key,
      value jsonb not null,
      updated_by text,
      updated_at timestamptz not null default now()
    )
  `);
  console.log('Migration complete: system_settings table created.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the migration against the dev DB**

Run (from `lautan-academy-backend/`): `node scripts/migrate-add-system-settings.js`
Expected: prints `Migration complete: system_settings table created.`, exits 0.

- [ ] **Step 3: Verify idempotency (safe to re-run)**

Run the same command again.
Expected: same success output, no error.

- [ ] **Step 4: Append the table to `sql/schema.sql`**

Add after the `master_delete_log` table definition (before the `create index` block at the bottom):

```sql
-- Generic key-value settings table. First user: Master Subsystem D's
-- maintenance kill-switch (key='maintenance', value={enabled,message}).
-- Reusable by future subsystems without another migration.
create table if not exists system_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 5: Verify the table exists with the right columns**

Run: `node -e "import('./src/config/db.js').then(async ({ pool }) => { const r = await pool.query(\"select column_name, data_type from information_schema.columns where table_name = 'system_settings' order by ordinal_position\"); console.log(r.rows); await pool.end(); })"`
Expected: prints 4 rows (`key`/text, `value`/jsonb, `updated_by`/text, `updated_at`/timestamp with time zone).

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-add-system-settings.js sql/schema.sql
git commit -m "feat: add system_settings table for Master Subsystem D's maintenance flag"
```

---

## Task 2: `routes/maintenance.js` — status read + master toggle

**Files:**
- Create: `lautan-academy-backend/src/routes/maintenance.js`
- Modify: `lautan-academy-backend/src/index.js` (mount router)

**Interfaces:**
- Consumes: `pool` from `../config/db.js`; `requireAuth, requireMaster` from `../middleware/auth.js`; `system_settings` table from Task 1.
- Produces: `GET /maintenance-status` (public), `POST /master/maintenance` (`requireAuth, requireMaster`). Response shapes:
  - `GET /maintenance-status` → `{ enabled: boolean, message: string }`
  - `POST /master/maintenance` → `{ status: 'ok' }` or `{ status: 'error', error }`
  Task 3's `checkMaintenance` middleware reads the same `system_settings` row independently (no shared function needed — it's a single query).

- [ ] **Step 1: Create the router file**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';

export const maintenanceRouter = Router();

// Public — blocked staff/managers need to read this too (the overlay's
// retry button and App.vue's on-load check both call it unauthenticated).
// See docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
maintenanceRouter.get('/maintenance-status', async (req, res) => {
  const { rows } = await pool.query(`select value from system_settings where key = 'maintenance'`);
  const value = rows[0]?.value || {};
  res.json({ enabled: value.enabled === true, message: value.message || '' });
});

maintenanceRouter.post('/master/maintenance', requireAuth, requireMaster, async (req, res) => {
  const enabled = req.body.enabled;
  const message = (req.body.message || '').toString();
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ status: 'error', error: 'enabled must be true or false.' });
  }
  await pool.query(
    `insert into system_settings (key, value, updated_by, updated_at)
     values ('maintenance', $1, $2, now())
     on conflict (key) do update set value = $1, updated_by = $2, updated_at = now()`,
    [JSON.stringify({ enabled, message }), req.session.scopeKey]
  );
  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Mount the router in `src/index.js`**

Add the import near the other route imports:

```js
import { maintenanceRouter } from './routes/maintenance.js';
```

Add the mount line before the other `app.use('/...', ...)` calls (no path prefix — the router's own routes are already absolute):

```js
app.use(maintenanceRouter);
```

- [ ] **Step 3: Start the dev server**

Run (from `lautan-academy-backend/`): `npm run dev` (leave running in background for the curl steps below and Task 3's).

- [ ] **Step 4: Get a master token**

```bash
curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<your master username>","password":"<your master password>"}'
```
Expected: `{"authorized":true,"token":"..."}`. Save the token as `$TOKEN` for the following steps.

- [ ] **Step 5: Status defaults to off before any row exists**

```bash
curl -s http://localhost:3000/maintenance-status
```
Expected: `{"enabled":false,"message":""}`.

- [ ] **Step 6: Non-master token is rejected on the toggle route**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/master/maintenance -H "Content-Type: application/json" -H "Authorization: Bearer <a regular staff or manager token>" -d '{"enabled":true,"message":"test"}'
```
Expected: `403`.

- [ ] **Step 7: Master can toggle on with a message**

```bash
curl -s -X POST http://localhost:3000/master/maintenance -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"enabled":true,"message":"Testing Subsystem D"}'
```
Expected: `{"status":"ok"}`.

- [ ] **Step 8: Status reflects the new state**

```bash
curl -s http://localhost:3000/maintenance-status
```
Expected: `{"enabled":true,"message":"Testing Subsystem D"}`.

- [ ] **Step 9: Toggle back off (leave the system clean for Task 3)**

```bash
curl -s -X POST http://localhost:3000/master/maintenance -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"enabled":false,"message":""}'
curl -s http://localhost:3000/maintenance-status
```
Expected: second call returns `{"enabled":false,"message":""}`.

- [ ] **Step 10: Missing `enabled` is rejected**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/master/maintenance -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"message":"no enabled field"}'
```
Expected: `400`.

- [ ] **Step 11: Commit**

```bash
git add src/routes/maintenance.js src/index.js
git commit -m "feat: add public maintenance-status read + Master toggle route"
```

---

## Task 3: `checkMaintenance` middleware — wire the block into every route

**Files:**
- Modify: `lautan-academy-backend/src/middleware/auth.js`
- Modify: `lautan-academy-backend/src/index.js`

**Interfaces:**
- Consumes: `pool` from `../config/db.js` (new import in `auth.js`); `system_settings` table from Task 1.
- Produces: `checkMaintenance(req, res, next)` middleware, exported from `middleware/auth.js`. Mounted ahead of `quizRouter`, `dataRouter`, `contentRouter`, `reportsRouter`, `staffRouter`, `resourcesRouter`, `questionsRouter` in `index.js`. `authRouter`, `masterPurgeRouter`, and the new `maintenanceRouter` stay unwrapped.

- [ ] **Step 1: Add `checkMaintenance` to `middleware/auth.js`**

Add the import at the top of the file:

```js
import { pool } from '../config/db.js';
```

Append the middleware function at the end of the file:

```js
// Global kill-switch check, applied to every router except /auth and
// /master/* (Master must always be able to log in and turn this back off).
// Fails open on a DB error — a hiccup reading this flag must not become a
// second outage on top of whatever the switch was meant to guard against.
// See docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
export async function checkMaintenance(req, res, next) {
  try {
    const { rows } = await pool.query(`select value from system_settings where key = 'maintenance'`);
    const value = rows[0]?.value;
    if (value?.enabled === true) {
      return res.status(503).json({
        authorized: false,
        maintenance: true,
        message: value.message || '',
      });
    }
    next();
  } catch (err) {
    console.error('checkMaintenance query failed, failing open:', err.message);
    next();
  }
}
```

- [ ] **Step 2: Wire it into every non-exempt router in `src/index.js`**

Add the import:

```js
import { checkMaintenance } from './middleware/auth.js';
```

Change the 7 non-exempt mount lines to insert `checkMaintenance` as middleware before each router (leave `/auth`, `/master/purge`, and the maintenance router's own mount from Task 2 untouched):

```js
app.use('/quiz', checkMaintenance, quizRouter);
app.use('/data', checkMaintenance, dataRouter);
app.use('/content', checkMaintenance, contentRouter);
app.use('/reports', checkMaintenance, reportsRouter);
app.use('/staff-roster-manage', checkMaintenance, staffRouter);
app.use('/resources', checkMaintenance, resourcesRouter);
app.use('/questions', checkMaintenance, questionsRouter);
```

- [ ] **Step 3: Restart the dev server** (picks up the middleware change)

Stop the `npm run dev` process from Task 2 and start it again.

- [ ] **Step 4: Confirm a normal (non-master) route works with maintenance off**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/questions
```
Expected: `200`.

- [ ] **Step 5: Turn maintenance on**

```bash
curl -s -X POST http://localhost:3000/master/maintenance -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"enabled":true,"message":"Scheduled DB migration"}'
```
Expected: `{"status":"ok"}`.

- [ ] **Step 6: A guarded public route now 503s with the maintenance shape**

```bash
curl -s -w "\n%{http_code}\n" http://localhost:3000/questions
```
Expected: body `{"authorized":false,"maintenance":true,"message":"Scheduled DB migration"}`, status `503`.

- [ ] **Step 7: A guarded authenticated route also 503s for a real staff/manager session**

```bash
curl -s -w "\n%{http_code}\n" http://localhost:3000/data/scoped-data -H "Authorization: Bearer <a real staff or manager token>"
```
Expected: same `maintenance: true` 503 shape — the request never reaches `dataRouter`'s own auth logic.

- [ ] **Step 8: `/auth/*` stays open while maintenance is on**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/auth/staff-roster?division=retail&outlet=<a real outlet>"
```
Expected: `200` (not 503) — proves the login-adjacent public route is exempt.

- [ ] **Step 9: `/master/purge/*` stays open for Master while maintenance is on**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/master/purge/staff/search?outlet=ZZ" -H "Authorization: Bearer $TOKEN"
```
Expected: `200` — Master's own high-privilege routes are never blocked by the switch.

- [ ] **Step 10: Turn maintenance back off, confirm the guarded route recovers**

```bash
curl -s -X POST http://localhost:3000/master/maintenance -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"enabled":false,"message":""}'
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/questions
```
Expected: second call returns `200`.

- [ ] **Step 11: Note on the fail-open path (no live test)**

The `catch` block's fail-open behavior (a `system_settings` query error still calls `next()` instead of blocking everything) is not exercised by a live induced-failure test in this task — this project's local dev DB is the same Postgres instance as production (see Known Fragility in `SCOPE_TRACKER.md`), so deliberately breaking a live query against it is not worth the risk for this one path. Verified by code review instead: confirm the `try/catch` in Step 1 wraps the query (not the `res.status(503)` branch) and that both paths in the `catch` block are `console.error` + `next()`, never a response that would itself block the request.

- [ ] **Step 12: Commit**

```bash
git add src/middleware/auth.js src/index.js
git commit -m "feat: add checkMaintenance middleware, wire into every non-exempt router"
```

---

## Task 4: Frontend `api/client.js` — maintenance functions

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js`

**Interfaces:**
- Consumes: `request(path, options)` helper already in this file; both backend routes from Task 2.
- Produces: `api.getMaintenanceStatus()`, `api.setMaintenanceStatus(enabled, message, masterToken)` — consumed by Task 5 (store) and Task 7 (Master Panel tab).

- [ ] **Step 1: Add the two functions to the `api` object**, right after `masterDeleteContent` (before the closing `}`):

```js
  getMaintenanceStatus: () => request('/maintenance-status'),
  setMaintenanceStatus: (enabled, message, masterToken) =>
    request('/master/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled, message }),
      headers: { Authorization: `Bearer ${masterToken}` },
    }),
```

- [ ] **Step 2: Build check**

Run (from `lautan-academy-frontend/`): `npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/client.js
git commit -m "feat: add api client functions for maintenance-status read/toggle"
```

---

## Task 5: `store/maintenance.js` — Pinia store + `request()` hook

**Files:**
- Create: `lautan-academy-frontend/src/store/maintenance.js`
- Modify: `lautan-academy-frontend/src/api/client.js`

**Interfaces:**
- Consumes: `api.getMaintenanceStatus` (Task 4) inside the store's `check()` action.
- Produces: `useMaintenanceStore()` — Pinia store with state `{ active: boolean, message: string }` and action `check()`. Consumed by Task 6 (`App.vue`, `MaintenanceOverlay.vue`) and by `request()` in this same task.

- [ ] **Step 1: Create the store**

```js
// Tracks whether the app-wide maintenance kill-switch (Master Subsystem D)
// is currently on. Two writers: check() (an explicit status read, used on
// app boot and by the overlay's retry button) and api/client.js's
// request() (an implicit write, triggered the moment any real API call
// comes back with the maintenance 503 shape). See
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
import { defineStore } from 'pinia'
import { api } from '../api/client'

export const useMaintenanceStore = defineStore('maintenance', {
  state: () => ({
    active: false,
    message: '',
  }),

  actions: {
    async check() {
      try {
        const data = await api.getMaintenanceStatus()
        this.active = !!data.enabled
        this.message = data.message || ''
      } catch {
        // Network/other failure reading the status itself — leave the
        // current state as-is rather than forcing the overlay open on a
        // transient error unrelated to the actual kill-switch.
      }
    },
  },
})
```

- [ ] **Step 2: Wire `request()` in `api/client.js` to detect the maintenance 503 shape**

In `src/api/client.js`, change the `request()` function's response handling:

```js
async function request(path, options = {}) {
  const token = getToken()
  const isFormData = options.body instanceof FormData
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))

  if (res.status === 503 && data.maintenance === true) {
    // Dynamic import, not a static top-of-file import: store/maintenance.js
    // imports `api` from this same file, so a static import here would be a
    // circular module reference — client.js could reach this line before
    // its own `export const api = {...}` (further down this file) has run,
    // leaving the store's `api` binding uninitialized. The dynamic import
    // only resolves once this function actually runs, by which point this
    // module has already finished loading, so the cycle never bites.
    const { useMaintenanceStore } = await import('../store/maintenance')
    const maintenance = useMaintenanceStore()
    maintenance.active = true
    maintenance.message = data.message || ''
    throw new Error(data.error || 'Maintenance')
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/store/maintenance.js src/api/client.js
git commit -m "feat: add maintenance Pinia store, detect maintenance 503 in request()"
```

---

## Task 6: `MaintenanceOverlay.vue` — full-screen block + `App.vue` wiring

**Files:**
- Create: `lautan-academy-frontend/src/components/MaintenanceOverlay.vue`
- Modify: `lautan-academy-frontend/src/App.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `useMaintenanceStore` (Task 5).
- Produces: `<MaintenanceOverlay />` component, no props/emits, self-contained. Mounted once in `App.vue`.

- [ ] **Step 1: Create the component**

```vue
<script setup>
import { useI18n } from 'vue-i18n'
import { useMaintenanceStore } from '../store/maintenance'

const { t } = useI18n()
const maintenance = useMaintenanceStore()

async function retry() {
  await maintenance.check()
  if (!maintenance.active) {
    window.location.reload()
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-ink/90 px-4">
    <div class="w-full max-w-sm bg-white rounded-xl2 shadow-lg p-6 space-y-4 text-center">
      <h2 class="font-display font-semibold text-ink text-lg">{{ t('maintenanceOverlay.title') }}</h2>
      <p class="text-slate text-sm">{{ t('maintenanceOverlay.body') }}</p>
      <p v-if="maintenance.message" class="text-ink text-sm font-medium border border-seafoam rounded-lg p-3">
        {{ maintenance.message }}
      </p>
      <button
        type="button"
        @click="retry"
        class="w-full bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg"
      >
        {{ t('maintenanceOverlay.tryAgain') }}
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Mount it in `App.vue` and check status on load**

Replace the full contents of `src/App.vue`:

```vue
<script setup>
// Sidebar shows for every logged-in state (staff or any manager role) —
// login screens stay full-width, no sidebar before there's an identity to
// show in its footer. MaintenanceOverlay is mounted unconditionally
// alongside both branches so it can cover the whole screen regardless of
// which one is active — see
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
import { computed, onMounted } from 'vue'
import { useAuthStore } from './store/auth'
import { useMaintenanceStore } from './store/maintenance'
import AppSidebar from './components/AppSidebar.vue'
import MaintenanceOverlay from './components/MaintenanceOverlay.vue'

const auth = useAuthStore()
const maintenance = useMaintenanceStore()
const showSidebar = computed(() => auth.isStaff || auth.isManager)

onMounted(() => {
  maintenance.check()
})
</script>

<template>
  <div v-if="showSidebar" class="flex">
    <AppSidebar />
    <div class="flex-1 min-w-0 pb-20 md:pb-0">
      <router-view />
    </div>
  </div>
  <router-view v-else />
  <MaintenanceOverlay v-if="maintenance.active" />
</template>
```

- [ ] **Step 3: Add i18n keys** — in `src/i18n/locales/en.json`, add a new top-level `"maintenanceOverlay"` key (sibling of `"masterPanel"`, not nested inside it):

```json
  "maintenanceOverlay": {
    "title": "Under Maintenance",
    "body": "The app is temporarily unavailable while we make some changes. Please check back shortly.",
    "tryAgain": "Try Again"
  },
```

In `src/i18n/locales/ms.json`, same location:

```json
  "maintenanceOverlay": {
    "title": "Dalam Penyelenggaraan",
    "body": "Aplikasi tidak tersedia buat sementara waktu semasa kami membuat perubahan. Sila cuba semula sebentar lagi.",
    "tryAgain": "Cuba Lagi"
  },
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Manual browser check — overlay appears and recovers**

With the backend dev server running and maintenance still off, run `npm run dev` for the frontend, log in as any staff/manager role. Then, from a terminal, turn maintenance on:

```bash
curl -s -X POST http://localhost:3000/master/maintenance -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"enabled":true,"message":"Manual test"}'
```

Trigger any action in the browser that hits the backend (e.g. navigate to a page that fetches data). Expected: `MaintenanceOverlay` covers the screen with "Manual test" shown. Click "Try Again" — expected: stays up (still on). Turn maintenance off via curl, click "Try Again" again — expected: page reloads and the overlay is gone. Also confirm: reloading the browser tab while maintenance is still ON (before turning it off) shows the overlay immediately on load, without needing to trigger an action first — proves the `onMounted` check in `App.vue` works, not just the reactive `request()` path.

- [ ] **Step 6: Commit**

```bash
git add src/components/MaintenanceOverlay.vue src/App.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add MaintenanceOverlay, wire status check into App.vue"
```

---

## Task 7: `MasterMaintenance.vue` — Master Panel tab

**Files:**
- Create: `lautan-academy-frontend/src/components/MasterMaintenance.vue`
- Modify: `lautan-academy-frontend/src/components/MasterPanel.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.getMaintenanceStatus`, `api.setMaintenanceStatus` (Task 4); `useMasterAuthStore` (`masterAuth.token`).
- Produces: `<MasterMaintenance />` component, emits `close`. Wired into `MasterPanel.vue`'s `maintenanceMode` tab.

- [ ] **Step 1: Create the component**

```vue
<script setup>
// Master-only: read/write the app-wide maintenance kill-switch (Subsystem
// D). Mirrors MasterPinReset.vue's back-button + status-message shape. See
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const enabled = ref(false)
const message = ref('')
const loading = ref(true)
const saving = ref(false)
const status = ref('')
const statusOk = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await api.getMaintenanceStatus()
    enabled.value = !!data.enabled
    message.value = data.message || ''
  } catch (err) {
    status.value = err.message || t('masterPanel.maintenanceMode.errorLoadFailed')
    statusOk.value = false
  } finally {
    loading.value = false
  }
}

async function save(nextEnabled) {
  saving.value = true
  status.value = ''
  try {
    const data = await api.setMaintenanceStatus(nextEnabled, message.value.trim(), masterAuth.token)
    if (data.status !== 'ok') throw new Error(data.error || t('masterPanel.maintenanceMode.errorSaveFailed'))
    enabled.value = nextEnabled
    status.value = nextEnabled ? t('masterPanel.maintenanceMode.successEnabled') : t('masterPanel.maintenanceMode.successDisabled')
    statusOk.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.maintenanceMode.errorSaveFailed')
    statusOk.value = false
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="px-5 py-4 space-y-4">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.maintenanceMode.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.maintenanceMode.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.maintenanceMode.intro') }}</p>
    </div>

    <p v-if="loading" class="text-slate text-xs">{{ t('masterPanel.maintenanceMode.loading') }}</p>
    <template v-else>
      <div class="flex items-center justify-between border border-seafoam rounded-lg px-3 py-2.5">
        <span class="text-sm text-ink">{{ enabled ? t('masterPanel.maintenanceMode.statusOn') : t('masterPanel.maintenanceMode.statusOff') }}</span>
        <span class="w-2 h-2 rounded-full" :class="enabled ? 'bg-coral' : 'bg-aqua'"></span>
      </div>

      <div>
        <label for="master-maintenance-message" class="block text-xs text-slate mb-1">{{ t('masterPanel.maintenanceMode.messageLabel') }}</label>
        <textarea
          id="master-maintenance-message"
          v-model="message"
          rows="3"
          :placeholder="t('masterPanel.maintenanceMode.messagePlaceholder')"
          class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm"
        ></textarea>
      </div>

      <button
        v-if="!enabled"
        type="button"
        :disabled="saving"
        @click="save(true)"
        class="w-full bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {{ saving ? t('masterPanel.maintenanceMode.saving') : t('masterPanel.maintenanceMode.enable') }}
      </button>
      <button
        v-else
        type="button"
        :disabled="saving"
        @click="save(false)"
        class="w-full bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {{ saving ? t('masterPanel.maintenanceMode.saving') : t('masterPanel.maintenanceMode.disable') }}
      </button>
    </template>

    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
  </div>
</template>
```

- [ ] **Step 2: Wire it into `MasterPanel.vue`**

In `src/components/MasterPanel.vue`, add the import next to `MasterDataPurge`:

```js
import MasterMaintenance from './MasterMaintenance.vue'
```

Add `'maintenanceMode'` to `ENABLED_TABS`:

```js
const ENABLED_TABS = ['pinReset', 'dataPurge', 'maintenanceMode']
```

Add the render branch next to `MasterDataPurge`'s:

```html
<MasterPinReset v-if="activeTab === 'pinReset'" @close="activeTab = null" />
<MasterDataPurge v-else-if="activeTab === 'dataPurge'" @close="activeTab = null" />
<MasterMaintenance v-else-if="activeTab === 'maintenanceMode'" @close="activeTab = null" />
```

- [ ] **Step 3: Add i18n keys** — in `src/i18n/locales/en.json`, inside the existing `"masterPanel"` object, add a `"maintenanceMode"` key as a sibling of `"pinReset"` (the `"tab"` object's `maintenanceMode` label already exists — this is the tab's own content strings):

```json
    "maintenanceMode": {
      "title": "Maintenance Mode",
      "intro": "When on, every staff and manager session is blocked from using the app (they can still log in) until you turn it back off. Your own Master session is never affected.",
      "back": "Back",
      "loading": "Loading...",
      "statusOn": "Maintenance is ON",
      "statusOff": "Maintenance is OFF",
      "messageLabel": "Message shown to blocked users (optional)",
      "messagePlaceholder": "e.g. Back online by 3pm",
      "enable": "Turn On",
      "disable": "Turn Off",
      "saving": "Saving...",
      "successEnabled": "Maintenance mode turned on.",
      "successDisabled": "Maintenance mode turned off.",
      "errorLoadFailed": "Could not load current status.",
      "errorSaveFailed": "Could not update."
    },
```

In `src/i18n/locales/ms.json`, same location:

```json
    "maintenanceMode": {
      "title": "Mod Penyelenggaraan",
      "intro": "Apabila aktif, semua sesi staf dan pengurus disekat daripada menggunakan aplikasi (mereka masih boleh log masuk) sehingga anda matikannya semula. Sesi Master anda sendiri tidak terjejas.",
      "back": "Kembali",
      "loading": "Memuatkan...",
      "statusOn": "Penyelenggaraan AKTIF",
      "statusOff": "Penyelenggaraan TIDAK AKTIF",
      "messageLabel": "Mesej untuk pengguna yang disekat (pilihan)",
      "messagePlaceholder": "cth. Kembali online jam 3 petang",
      "enable": "Aktifkan",
      "disable": "Matikan",
      "saving": "Menyimpan...",
      "successEnabled": "Mod penyelenggaraan diaktifkan.",
      "successDisabled": "Mod penyelenggaraan dimatikan.",
      "errorLoadFailed": "Gagal memuatkan status semasa.",
      "errorSaveFailed": "Gagal mengemas kini."
    },
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Full end-to-end manual browser check**

With both dev servers running (backend + frontend), maintenance currently OFF:

1. Log in as Master, open the Master Panel, click the "Maintenance Mode" tab (no longer disabled). Confirm it loads showing "Penyelenggaraan TIDAK AKTIF"/"Maintenance is OFF".
2. Type a message, click "Turn On". Confirm the status flips to ON and a success message shows.
3. In a second browser tab/profile (or after logging out of Master), log in as a regular staff or manager account. Confirm `MaintenanceOverlay` covers the screen immediately (either on load or on the first action), showing the message from step 2, in both EN and MS (use `LanguageSwitcher` to check — note the overlay's fixed chrome text switches, the free-text message itself does not translate, by design).
4. Confirm the login screen itself is still reachable and functional while maintenance is ON (log out and back in as the same staff account).
5. Back in the Master tab (still logged in as Master throughout — confirm the Master Panel itself was never blocked), click "Turn Off". Confirm success message and status flips to OFF.
6. Back in the staff tab, click "Try Again" on the overlay. Confirm the page reloads and the overlay is gone, app usable again.
7. Confirm EN + MS render correctly for the Master Panel tab itself (label, intro, toggle labels).

- [ ] **Step 6: Commit**

```bash
git add src/components/MasterMaintenance.vue src/components/MasterPanel.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: wire MasterMaintenance tab into Master Panel"
```

---

## Out-of-scope confirmation

Scheduled/timed windows, per-role or per-outlet partial maintenance, vanilla `index.html` changes, and any change to `requireScope`/`requireAuth` are explicitly not part of this subsystem (matches the design spec). Subsystems E-H remain untouched.
