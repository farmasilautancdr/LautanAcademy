# Per-Manager Passwords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared PIN per manager role (Outlet Manager, Warehouse Manager, Area Manager) with per-outlet/per-region passwords, while keeping the shared PIN alive as a master recovery/handover key — no email, no hard cutover.

**Architecture:** New `manager_credentials` table (one row per registered outlet/region) sits alongside the existing `manager_pins` table (reframed as the master/recovery PIN). `/auth/manager-login` checks `manager_credentials` first, falls back to `manager_pins` if that scope hasn't registered yet. A new `/auth/manager-register` endpoint verifies the master PIN and upserts a personal password — the same action covers first-time signup, forgotten password, and outlet handover. A new Supervisor-only `/auth/rotate-master-pin` endpoint lets Supervisor set a fresh master PIN per role without DB access.

**Tech Stack:** Node.js/Express/Postgres backend (`lautan-academy-backend`), Vue 3/Pinia frontend (`lautan-academy-frontend`), bcrypt for all hashing, same Postgres-backed rate-limit table (`rate_limits`) already in use.

## Global Constraints

- No new libraries/frameworks (CLAUDE.md) — this plan introduces none.
- No email, no external service dependency (explicit design decision, see spec).
- Supervisor role itself stays on its existing shared-PIN login, unchanged.
- New password minimum: 6 characters, no other complexity rule.
- This codebase has no automated test runner — verification throughout this plan follows the pattern already established this session: mint a JWT locally (backend `.env` has `JWT_SECRET`) and hit the running server directly with curl/node scripts, checking real responses. Do this against local dev during implementation; a final production verification pass with cleanup is Task 8.
- Full design context: `docs/superpowers/specs/2026-08-06-manager-auth-design.md`.

---

### Task 1: `manager_credentials` table

**Files:**
- Create: `lautan-academy-backend/scripts/migrate-add-manager-credentials.js`
- Modify: `lautan-academy-backend/sql/schema.sql` (add table definition after `manager_pins`, for documentation — the running DB is migrated via the script, not this file)

**Interfaces:**
- Produces: `manager_credentials` table with columns `id, role, scope_key, password_hash, created_at, updated_at`, unique constraint on `(role, scope_key)`. Tasks 2–4 query/write this table directly via `pool.query`.

- [ ] **Step 1: Write the migration script**

Create `lautan-academy-backend/scripts/migrate-add-manager-credentials.js`:

```js
// One-off: adds manager_credentials so Outlet/Warehouse/Area Manager can
// register a personal per-outlet/per-region password instead of the single
// shared PIN per role in manager_pins (which becomes the master/recovery
// PIN going forward — see
// docs/superpowers/specs/2026-08-06-manager-auth-design.md). Safe to re-run.
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`
    create table if not exists manager_credentials (
      id bigserial primary key,
      role text not null,
      scope_key text not null,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (role, scope_key)
    )
  `);
  console.log('Migration complete: manager_credentials table created.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against local/dev DB and verify**

Run: `cd lautan-academy-backend && node scripts/migrate-add-manager-credentials.js`
Expected output: `Migration complete: manager_credentials table created.`

Then verify the table exists with the right shape:

Run:
```bash
node -e "
import('dotenv/config').then(async () => {
  const { pool } = await import('./src/config/db.js');
  const r = await pool.query(\"select column_name, data_type from information_schema.columns where table_name = 'manager_credentials' order by ordinal_position\");
  console.log(r.rows);
  await pool.end();
});
"
```
Expected: rows for `id, role, scope_key, password_hash, created_at, updated_at` in that order.

- [ ] **Step 3: Add the table to `sql/schema.sql` for documentation**

In `lautan-academy-backend/sql/schema.sql`, immediately after the existing `manager_pins` table definition, add:

```sql
create table if not exists manager_credentials (
  id bigserial primary key,
  role text not null,            -- 'outlet_manager' | 'warehouse_manager' | 'area_manager'
  scope_key text not null,       -- outlet code (uppercase), or area id for area_manager
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, scope_key)
);
```

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-backend
git add scripts/migrate-add-manager-credentials.js sql/schema.sql
git commit -m "Add manager_credentials table for per-outlet/per-region manager passwords"
```

---

### Task 2: Rework `/auth/manager-login` to check per-scope credentials first

**Files:**
- Modify: `lautan-academy-backend/src/routes/auth.js:56-97` (the existing `manager-login` handler)

**Interfaces:**
- Consumes: `manager_credentials` table from Task 1.
- Produces: same response shape as before — `{ authorized: true, token }` or `{ authorized: false, error }` — no change for any caller (frontend `api.managerLogin` untouched).

- [ ] **Step 1: See current behavior before changing it**

With the backend running locally (`cd lautan-academy-backend && node src/index.js`), confirm today's shared-PIN login still works (use a real current master PIN and a real outlet you know, e.g. from `.env`/notes — do not commit or paste the PIN itself anywhere):

```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","pin":"<current master PIN>"}'
```
Expected: `{"authorized":true,"token":"..."}`. This is the baseline behavior Task 2 must not break for outlets that haven't registered.

- [ ] **Step 2: Replace the handler**

In `lautan-academy-backend/src/routes/auth.js`, replace the entire existing `manager-login` handler (lines 56-97) with:

```js
// Manager: role + PIN/password (+ outlet, unless supervisor) -> JWT.
// Outlet/Warehouse/Area Manager may have a personal per-outlet/per-region
// password registered (manager_credentials, see /manager-register below) —
// if so, that takes priority. Falls back to the shared master PIN in
// manager_pins if this scope hasn't registered one yet (or always, for
// supervisor, which has no registration path). See
// docs/superpowers/specs/2026-08-06-manager-auth-design.md.
authRouter.post('/manager-login', async (req, res) => {
  const role = (req.body.role || '').toString();
  const pin = (req.body.pin || '').toString();
  const validRoles = ['outlet_manager', 'warehouse_manager', 'area_manager', 'supervisor'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ authorized: false, error: 'Unknown role.' });
  }

  // area_manager reuses the "outlet" field to carry the area id instead —
  // scope is the whole region's outlets, not one. Not uppercased: area ids
  // are mixed-case ("R1 - AMIRUL") and must match areas.js exactly.
  let scopeKey;
  if (role === 'supervisor') {
    scopeKey = 'ALL';
  } else if (role === 'area_manager') {
    const areaId = (req.body.outlet || '').toString().trim();
    if (!areaId || !outletsForArea(areaId)) {
      return res.status(400).json({ authorized: false, error: 'Select a valid area.' });
    }
    scopeKey = areaId;
  } else {
    scopeKey = (req.body.outlet || '').toString().trim().toUpperCase();
    if (!scopeKey) return res.status(400).json({ authorized: false, error: 'Select an outlet/location first.' });
  }

  let credRow = null;
  if (role !== 'supervisor') {
    const { rows } = await pool.query(
      'select password_hash from manager_credentials where role = $1 and scope_key = $2',
      [role, scopeKey]
    );
    credRow = rows[0] || null;
  }

  // Separate lockout counters: a registered outlet's personal password is
  // its own attack surface from the shared master PIN's — sharing one
  // counter between them would let a wrong personal-password guess and a
  // wrong master-PIN guess against a DIFFERENT outlet blend together.
  const failKey = credRow ? `mgr_${role}_${scopeKey}` : `mgr_master_${role}`;
  if (await isLockedOut(failKey)) {
    return res.status(429).json({ authorized: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  let ok;
  if (credRow) {
    ok = pin && await bcrypt.compare(pin, credRow.password_hash);
  } else {
    const { rows } = await pool.query('select pin_hash from manager_pins where role = $1', [role]);
    const match = rows[0];
    ok = match && pin && await bcrypt.compare(pin, match.pin_hash);
  }
  if (!ok) {
    await recordFailure(failKey);
    return res.json({ authorized: false, error: 'Incorrect password.' });
  }
  await clearFailures(failKey);

  const token = issueToken(role, scopeKey);
  res.json({ authorized: true, token });
});
```

- [ ] **Step 3: Verify the fallback path still works (unregistered outlet)**

Restart the local server, then re-run the exact same curl from Step 1:
```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","pin":"<current master PIN>"}'
```
Expected: still `{"authorized":true,"token":"..."}` — no `manager_credentials` row exists for AJ yet, so it must fall through to `manager_pins` exactly as before.

- [ ] **Step 4: Verify wrong master PIN still fails and locks out correctly**

```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","pin":"0000"}'
```
Expected: `{"authorized":false,"error":"Incorrect password."}` (assuming `0000` isn't the real PIN). Repeat 4 more times to hit the 5-attempt lockout, 6th attempt should return 429. Then clear the test lockout row before moving on:
```bash
node -e "
import('dotenv/config').then(async () => {
  const { pool } = await import('./src/config/db.js');
  await pool.query(\"delete from rate_limits where key = 'mgr_master_outlet_manager'\");
  await pool.end();
});
"
```

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add src/routes/auth.js
git commit -m "manager-login: check per-outlet credentials first, fall back to master PIN"
```

---

### Task 3: `POST /auth/manager-register`

**Files:**
- Modify: `lautan-academy-backend/src/routes/auth.js` (add new route, after `manager-login`)

**Interfaces:**
- Consumes: `manager_credentials` (Task 1), `manager_pins` (existing), `outletsForArea` (already imported in this file).
- Produces: `{ authorized: true, token }` on success (same shape as `manager-login`, so the frontend can reuse one auth-store code path), `{ authorized: false, error }` on failure. Task 6 (frontend) calls this via `api.managerRegister`.

- [ ] **Step 1: Add the route**

In `lautan-academy-backend/src/routes/auth.js`, add immediately after the `manager-login` handler:

```js
// Register (or re-register) a personal password for one outlet/region.
// Requires today's master PIN as proof of legitimacy — the same action
// covers first-time signup, a forgotten password, and outlet handover to a
// new manager, since it always overwrites whatever credential row already
// existed rather than requiring it to be deleted first. supervisor has no
// registration path (single shared account, out of scope). See
// docs/superpowers/specs/2026-08-06-manager-auth-design.md.
authRouter.post('/manager-register', async (req, res) => {
  const role = (req.body.role || '').toString();
  const masterPin = (req.body.masterPin || '').toString();
  const newPassword = (req.body.newPassword || '').toString();
  const validRoles = ['outlet_manager', 'warehouse_manager', 'area_manager'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ authorized: false, error: 'Unknown role.' });
  }

  let scopeKey;
  if (role === 'area_manager') {
    const areaId = (req.body.outlet || '').toString().trim();
    if (!areaId || !outletsForArea(areaId)) {
      return res.status(400).json({ authorized: false, error: 'Select a valid area.' });
    }
    scopeKey = areaId;
  } else {
    scopeKey = (req.body.outlet || '').toString().trim().toUpperCase();
    if (!scopeKey) return res.status(400).json({ authorized: false, error: 'Select an outlet/location first.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ authorized: false, error: 'Password must be at least 6 characters.' });
  }

  // Shares its lockout counter with manager-login's master-PIN fallback
  // path (mgr_master_${role}) — a separate counter here would let an
  // attacker double their master-PIN guess budget by alternating between
  // logging in and registering. Same reasoning as the verify-pin +
  // manager-login lockout unification fixed earlier.
  const failKey = `mgr_master_${role}`;
  if (await isLockedOut(failKey)) {
    return res.status(429).json({ authorized: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  const { rows } = await pool.query('select pin_hash from manager_pins where role = $1', [role]);
  const match = rows[0];
  const ok = match && masterPin && await bcrypt.compare(masterPin, match.pin_hash);
  if (!ok) {
    await recordFailure(failKey);
    return res.json({ authorized: false, error: 'Incorrect master PIN.' });
  }
  await clearFailures(failKey);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    `insert into manager_credentials (role, scope_key, password_hash) values ($1, $2, $3)
     on conflict (role, scope_key) do update set password_hash = excluded.password_hash, updated_at = now()`,
    [role, scopeKey, passwordHash]
  );

  const token = issueToken(role, scopeKey);
  res.json({ authorized: true, token });
});
```

- [ ] **Step 2: Verify registration + immediate login with the new password**

With the local server running:
```bash
curl -s -X POST http://localhost:3000/auth/manager-register \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","masterPin":"<current master PIN>","newPassword":"testpass123"}'
```
Expected: `{"authorized":true,"token":"..."}`.

Then confirm the OLD master PIN no longer works for AJ (it now has its own credential row, per Task 2's logic):
```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","pin":"<current master PIN>"}'
```
Expected: `{"authorized":false,"error":"Incorrect password."}`.

Then confirm the NEW password works:
```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","pin":"testpass123"}'
```
Expected: `{"authorized":true,"token":"..."}`.

- [ ] **Step 3: Verify wrong master PIN is rejected and re-registration (handover) overwrites cleanly**

```bash
curl -s -X POST http://localhost:3000/auth/manager-register \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","masterPin":"wrong","newPassword":"anotherpass1"}'
```
Expected: `{"authorized":false,"error":"Incorrect master PIN."}`.

Then re-register AJ with the correct master PIN and a different password (simulating a handover), confirm the old `testpass123` no longer works and the new one does:
```bash
curl -s -X POST http://localhost:3000/auth/manager-register \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","masterPin":"<current master PIN>","newPassword":"handoverpass1"}'
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","pin":"testpass123"}'
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","outlet":"AJ","pin":"handoverpass1"}'
```
Expected: register succeeds, old password fails, new password succeeds.

- [ ] **Step 4: Clean up the test credential row**

```bash
node -e "
import('dotenv/config').then(async () => {
  const { pool } = await import('./src/config/db.js');
  await pool.query(\"delete from manager_credentials where role = 'outlet_manager' and scope_key = 'AJ'\");
  await pool.end();
});
"
```

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add src/routes/auth.js
git commit -m "Add POST /auth/manager-register — master-PIN-gated per-outlet password signup"
```

---

### Task 4: `POST /auth/rotate-master-pin` (Supervisor-only)

**Files:**
- Modify: `lautan-academy-backend/src/routes/auth.js` (add `requireAuth, requireScope` to the existing import from `../middleware/auth.js`, add new route)

**Interfaces:**
- Consumes: `requireAuth`, `requireScope` from `../middleware/auth.js` (already used elsewhere, e.g. `staff.js`).
- Produces: `{ status: 'ok' }` or `{ status: 'error', error }`. Task 7 (frontend) calls this via `api.rotateMasterPin`.

- [ ] **Step 1: Update the import line**

In `lautan-academy-backend/src/routes/auth.js`, change:
```js
import { issueToken } from '../middleware/auth.js';
```
to:
```js
import { issueToken, requireAuth, requireScope } from '../middleware/auth.js';
```

- [ ] **Step 2: Add the route**

Add at the end of the file (after `verify-pin`), before the closing of the file:

```js
// Supervisor-only: set a new master/recovery PIN for one role. Write-only
// — manager_pins only ever stores a bcrypt hash, so there is no "current
// value" this could return even if it tried. See
// docs/superpowers/specs/2026-08-06-manager-auth-design.md.
authRouter.post('/rotate-master-pin', requireAuth, requireScope('supervisor'), async (req, res) => {
  const role = (req.body.role || '').toString();
  const newMasterPin = (req.body.newMasterPin || '').toString();
  const validRoles = ['outlet_manager', 'warehouse_manager', 'area_manager'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ status: 'error', error: 'Unknown role.' });
  }
  if (!newMasterPin) {
    return res.status(400).json({ status: 'error', error: 'Enter a new master PIN.' });
  }

  const pinHash = await bcrypt.hash(newMasterPin, 10);
  await pool.query(
    `insert into manager_pins (role, pin_hash) values ($1, $2)
     on conflict (role) do update set pin_hash = excluded.pin_hash`,
    [role, pinHash]
  );
  res.json({ status: 'ok' });
});
```

- [ ] **Step 3: Verify auth gating and functional rotation**

First confirm it's rejected without a Supervisor token:
```bash
curl -s -X POST http://localhost:3000/auth/rotate-master-pin \
  -H "Content-Type: application/json" \
  -d '{"role":"outlet_manager","newMasterPin":"whatever"}'
```
Expected: `{"authorized":false,"error":"No session token."}` (from `requireAuth`).

Then mint a real supervisor token locally (have `JWT_SECRET` in `.env`) and confirm rotation works end-to-end — rotate a role's master PIN, confirm the OLD master PIN stops working for a not-yet-registered outlet, confirm the NEW one works:

```bash
node -e "
import('dotenv/config').then(async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ scopeType: 'supervisor', scopeKey: 'ALL' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const res = await fetch('http://localhost:3000/auth/rotate-master-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ role: 'warehouse_manager', newMasterPin: 'rotatedtest1' }),
  });
  console.log(res.status, await res.text());
});
"
```
Expected: `200 {"status":"ok"}`.

Then confirm login for an unregistered warehouse location now requires the NEW master PIN:
```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"warehouse_manager","outlet":"Warehouse","pin":"rotatedtest1"}'
```
Expected: `{"authorized":true,"token":"..."}`.

**Important:** this permanently changes the real `warehouse_manager` master PIN. Before running this verification, confirm with the user what the real current warehouse_manager master PIN should be restored to afterward — rotate it back to that value as the last step, using the same rotate-master-pin call, before ending this task. Do not leave the master PIN set to `rotatedtest1`.

- [ ] **Step 4: Restore the real master PIN**

Rotate `warehouse_manager` back to its real value (confirmed with the user), using the same node script pattern as Step 3 with the real PIN in place of `rotatedtest1`.

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add src/routes/auth.js
git commit -m "Add POST /auth/rotate-master-pin — Supervisor-only master PIN rotation"
```

---

### Task 5: Frontend API client + auth store additions

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js` (add two functions)
- Modify: `lautan-academy-frontend/src/store/auth.js` (add `registerManager` action)

**Interfaces:**
- Produces: `api.managerRegister(payload)`, `api.rotateMasterPin(payload)`, `auth.registerManager(role, outlet, masterPin, newPassword, label, outlets)`. Tasks 6 and 7 consume these.

- [ ] **Step 1: Add API functions**

In `lautan-academy-frontend/src/api/client.js`, add after the existing `managerLogin` entry:

```js
  managerRegister: (payload) => request('/auth/manager-register', { method: 'POST', body: JSON.stringify(payload) }),
```

And add near the end of the `api` object (after `checkAiAnswer`):
```js
  rotateMasterPin: (payload) => request('/auth/rotate-master-pin', { method: 'POST', body: JSON.stringify(payload) }),
```

- [ ] **Step 2: Add the `registerManager` auth store action**

In `lautan-academy-frontend/src/store/auth.js`, add after the existing `loginManager` action (mirrors it exactly, just calling a different `api` function):

```js
    // Same response shape as loginManager (manager-register returns
    // { authorized, token } on success too) — registering also logs you
    // in immediately, no separate login step needed after.
    async registerManager(role, outlet, masterPin, newPassword, label = '', outlets = null) {
      const data = await api.managerRegister({ role, outlet, masterPin, newPassword })
      if (!data.authorized) throw new Error(data.error || 'Registration failed')
      this.token = data.token
      this.manager = { role, outlet, label, outlets }
      this.staff = null
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_manager', JSON.stringify(this.manager))
      localStorage.removeItem('lautan_staff')
    },
```

- [ ] **Step 3: Verify with a build**

```bash
cd lautan-academy-frontend
npm run build
```
Expected: builds with no errors (this is a syntax/import check only — no new UI consumes these yet, that's Tasks 6-7).

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-frontend
git add src/api/client.js src/store/auth.js
git commit -m "Add managerRegister/rotateMasterPin API calls and registerManager auth action"
```

---

### Task 6: Registration screens (Outlet/Warehouse Manager + Area Manager)

**Files:**
- Create: `lautan-academy-frontend/src/views/ManagerRegisterView.vue`
- Create: `lautan-academy-frontend/src/views/AreaManagerRegisterView.vue`
- Modify: `lautan-academy-frontend/src/views/ManagerLoginView.vue` (add a link)
- Modify: `lautan-academy-frontend/src/views/AreaManagerLoginView.vue` (add a link)
- Modify: `lautan-academy-frontend/src/router/index.js` (add two routes)

**Interfaces:**
- Consumes: `auth.registerManager` (Task 5), `AREAS`/`outletsForArea` from `../config/areas` (existing).

- [ ] **Step 1: Create `ManagerRegisterView.vue`**

Mirrors `ManagerLoginView.vue`'s division toggle and outlet picker exactly (same `OUTLET_LIST`/`WAREHOUSE_LOCATIONS` arrays), adding master PIN + new password + confirm fields:

```vue
<script setup>
// Mirrors ManagerLoginView.vue's division toggle and outlet list. Used for
// first-time signup, a forgotten password, or outlet handover — all three
// are the same action here: prove you know today's master PIN, set a new
// password. See docs/superpowers/specs/2026-08-06-manager-auth-design.md.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'

const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];

const division = ref('retail')
const outlet = ref('')
const masterPin = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS : OUTLET_LIST)

function switchDivision(d) {
  division.value = d
  outlet.value = ''
}

async function handleRegister() {
  error.value = ''
  if (!outlet.value) {
    error.value = division.value === 'warehouse' ? 'Select your location.' : 'Select your outlet.'
    return
  }
  if (!masterPin.value.trim()) {
    error.value = "Enter today's master PIN."
    return
  }
  if (newPassword.value.length < 6) {
    error.value = 'New password must be at least 6 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  const role = division.value === 'warehouse' ? 'warehouse_manager' : 'outlet_manager'
  try {
    await auth.registerManager(role, outlet.value, masterPin.value.trim(), newPassword.value)
    router.push(role === 'warehouse_manager' ? '/warehouse-manager' : '/manager')
  } catch (err) {
    error.value = err.message || 'Could not register. Check the master PIN.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3">
          <img :src="logoUrl" alt="Lautan Academy" class="w-20 h-20 shrink-0" />
          <div class="text-left h-20 flex flex-col justify-center">
            <h1 class="font-display text-3xl font-bold text-ink tracking-tight leading-none">LAUTAN</h1>
            <p class="font-display text-xs font-medium text-aqua tracking-[0.35em] leading-none mt-1.5">ACADEMY</p>
          </div>
        </div>
        <p class="text-slate text-sm mt-3 text-center">Register — Outlet / Warehouse Manager</p>
      </div>

      <form @submit.prevent="handleRegister" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1.5">Division</label>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Division">
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'retail'"
              @click="switchDivision('retail')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'retail' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >Retail</button>
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'warehouse'"
              @click="switchDivision('warehouse')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'warehouse' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >Warehouse</button>
          </div>
        </div>

        <div>
          <label for="outlet" class="block text-sm font-medium text-ink mb-1">{{ division === 'warehouse' ? 'Location' : 'Outlet' }}</label>
          <select id="outlet" v-model="outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">{{ division === 'warehouse' ? 'Select location...' : 'Select outlet...' }}</option>
            <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <div>
          <label for="master-pin" class="block text-sm font-medium text-ink mb-1">Master PIN</label>
          <input
            id="master-pin"
            v-model="masterPin"
            type="password"
            placeholder="••••••"
            class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
          <p class="text-xs text-slate mt-1">Get this from Supervisor/HQ — it proves you're the legitimate manager for this {{ division === 'warehouse' ? 'location' : 'outlet' }}.</p>
        </div>

        <div>
          <label for="new-password" class="block text-sm font-medium text-ink mb-1">New Password</label>
          <input
            id="new-password"
            v-model="newPassword"
            type="password"
            placeholder="At least 6 characters"
            class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-ink mb-1">Confirm Password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            placeholder="Re-enter password"
            class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? 'Registering...' : 'Register' }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        Already registered? <router-link to="/manager-login" class="underline">Log in here</router-link>
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `AreaManagerRegisterView.vue`**

Mirrors `AreaManagerLoginView.vue`'s area picker:

```vue
<script setup>
// Mirrors AreaManagerLoginView.vue's area picker. See ManagerRegisterView.vue
// for the outlet/warehouse counterpart and the shared design rationale.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'
import { AREAS, outletsForArea } from '../config/areas'

const areaId = ref('')
const masterPin = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

async function handleRegister() {
  error.value = ''
  if (!areaId.value) {
    error.value = 'Select your area.'
    return
  }
  if (!masterPin.value.trim()) {
    error.value = "Enter today's master PIN."
    return
  }
  if (newPassword.value.length < 6) {
    error.value = 'New password must be at least 6 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    await auth.registerManager('area_manager', areaId.value, masterPin.value.trim(), newPassword.value, areaId.value, outletsForArea(areaId.value))
    router.push('/area-manager')
  } catch (err) {
    error.value = err.message || 'Could not register. Check the master PIN.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3">
          <img :src="logoUrl" alt="Lautan Academy" class="w-20 h-20 shrink-0" />
          <div class="text-left h-20 flex flex-col justify-center">
            <h1 class="font-display text-3xl font-bold text-ink tracking-tight leading-none">LAUTAN</h1>
            <p class="font-display text-xs font-medium text-aqua tracking-[0.35em] leading-none mt-1.5">ACADEMY</p>
          </div>
        </div>
        <p class="text-slate text-sm mt-3 text-center">Register — Area Manager</p>
      </div>

      <form @submit.prevent="handleRegister" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">Area</label>
          <select v-model="areaId" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">Select your area...</option>
            <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
          </select>
        </div>

        <div>
          <label for="master-pin" class="block text-sm font-medium text-ink mb-1">Master PIN</label>
          <input
            id="master-pin"
            v-model="masterPin"
            type="password"
            placeholder="••••••"
            class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
          <p class="text-xs text-slate mt-1">Get this from Supervisor/HQ — it proves you're the legitimate manager for this region.</p>
        </div>

        <div>
          <label for="new-password" class="block text-sm font-medium text-ink mb-1">New Password</label>
          <input
            id="new-password"
            v-model="newPassword"
            type="password"
            placeholder="At least 6 characters"
            class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-ink mb-1">Confirm Password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            placeholder="Re-enter password"
            class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? 'Registering...' : 'Register' }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        Already registered? <router-link to="/area-manager-login" class="underline">Log in here</router-link>
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Add links from the login screens**

In `ManagerLoginView.vue`, immediately after the existing:
```html
      <p class="text-center text-slate text-xs mt-2">
        Supervisor? <router-link to="/supervisor-login" class="underline">Log in here</router-link>
      </p>
```
add:
```html
      <p class="text-center text-slate text-xs mt-2">
        First time? <router-link to="/manager-register" class="underline">Register your outlet</router-link>
      </p>
```

In `AreaManagerLoginView.vue`, immediately after the existing:
```html
      <p class="text-center text-slate text-xs mt-2">
        Supervisor? <router-link to="/supervisor-login" class="underline">Log in here</router-link>
      </p>
```
add:
```html
      <p class="text-center text-slate text-xs mt-2">
        First time? <router-link to="/area-manager-register" class="underline">Register your region</router-link>
      </p>
```

- [ ] **Step 4: Wire up the router**

In `lautan-academy-frontend/src/router/index.js`, add imports after the existing `AreaManagerLoginView` import:
```js
import ManagerRegisterView from '../views/ManagerRegisterView.vue'
import AreaManagerRegisterView from '../views/AreaManagerRegisterView.vue'
```

Add routes after the existing `/area-manager-login` route:
```js
    { path: '/manager-register', name: 'manager-register', component: ManagerRegisterView },
    { path: '/area-manager-register', name: 'area-manager-register', component: AreaManagerRegisterView },
```

No `meta` needed — reachable regardless of auth state, matching that the endpoint's own security is the master-PIN check, not session state.

- [ ] **Step 5: Build and manually verify routing**

```bash
cd lautan-academy-frontend
npm run build
```
Expected: no errors.

Start dev server (`npm run dev`), open `/manager-register` and `/area-manager-register` directly in a browser, confirm both render without console errors and the "Already registered? Log in here" links work. Also open `/manager-login` and `/area-manager-login`, confirm the new "First time? Register..." links appear and navigate correctly.

- [ ] **Step 6: Commit**

```bash
cd lautan-academy-frontend
git add src/views/ManagerRegisterView.vue src/views/AreaManagerRegisterView.vue src/views/ManagerLoginView.vue src/views/AreaManagerLoginView.vue src/router/index.js
git commit -m "Add manager/area-manager registration screens"
```

---

### Task 7: Supervisor "Manager Access" page (master PIN rotation UI)

**Files:**
- Create: `lautan-academy-frontend/src/views/SupervisorManagerAccessView.vue`
- Modify: `lautan-academy-frontend/src/router/index.js` (add route)
- Modify: `lautan-academy-frontend/src/components/AppSidebar.vue` (add nav item + icon)

**Interfaces:**
- Consumes: `api.rotateMasterPin` (Task 5).

- [ ] **Step 1: Create the view**

```vue
<script setup>
// Supervisor-only: set a new master/recovery PIN per role. Write-only —
// the current value is never shown back (it's bcrypt-hashed, not
// recoverable). See docs/superpowers/specs/2026-08-06-manager-auth-design.md.
import { ref } from 'vue'
import { api } from '../api/client'

const ROLES = [
  { role: 'outlet_manager', label: 'Outlet Manager' },
  { role: 'warehouse_manager', label: 'Warehouse Manager' },
  { role: 'area_manager', label: 'Area Manager' },
]

const pins = ref({ outlet_manager: '', warehouse_manager: '', area_manager: '' })
const saving = ref({ outlet_manager: false, warehouse_manager: false, area_manager: false })
const status = ref({ outlet_manager: '', warehouse_manager: '', area_manager: '' })

async function rotate(role) {
  status.value[role] = ''
  const newMasterPin = pins.value[role].trim()
  if (!newMasterPin) {
    status.value[role] = 'Enter a new master PIN.'
    return
  }
  saving.value[role] = true
  try {
    await api.rotateMasterPin({ role, newMasterPin })
    pins.value[role] = ''
    status.value[role] = 'Master PIN updated.'
  } catch (err) {
    status.value[role] = err.message || 'Could not update.'
  } finally {
    saving.value[role] = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Supervisor</p>
      <h1 class="font-display text-xl font-semibold text-white">Manager Access</h1>
    </header>

    <main class="max-w-2xl mx-auto px-6 py-8 space-y-4">
      <p class="text-slate text-sm mb-2">Set a new master PIN per role. This is the recovery/handover PIN managers use to register or re-register their outlet/region — not a login PIN itself once they've set their own password. The current value can't be shown back, only replaced.</p>

      <div v-for="r in ROLES" :key="r.role" class="bg-white rounded-xl2 p-5 shadow-sm">
        <p class="text-sm font-medium text-ink mb-2">{{ r.label }}</p>
        <div class="flex items-center gap-2">
          <input
            v-model="pins[r.role]"
            type="text"
            placeholder="New master PIN"
            class="flex-1 min-w-0 border border-slate/30 rounded-lg py-2 px-3 text-sm"
          />
          <button
            type="button"
            @click="rotate(r.role)"
            :disabled="saving[r.role]"
            class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shrink-0"
          >
            {{ saving[r.role] ? 'Saving...' : 'Set' }}
          </button>
        </div>
        <p v-if="status[r.role]" class="text-xs mt-2" :class="status[r.role].includes('updated') ? 'text-aqua' : 'text-coral'">{{ status[r.role] }}</p>
      </div>
    </main>
  </div>
</template>
```

Note the `flex-1 min-w-0` on the PIN input — deliberately applying the mobile-overflow fix pattern from earlier this session (see `ManageStaffPanel.vue`), not a coincidence.

- [ ] **Step 2: Wire up the router**

In `lautan-academy-frontend/src/router/index.js`, add import after `SupervisorAddResourcesView`:
```js
import SupervisorManagerAccessView from '../views/SupervisorManagerAccessView.vue'
```

Add route after the existing `/supervisor/add-resources` route:
```js
    { path: '/supervisor/manager-access', name: 'supervisor-manager-access', component: SupervisorManagerAccessView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
```

- [ ] **Step 3: Add sidebar nav entry**

In `lautan-academy-frontend/src/components/AppSidebar.vue`, add a new icon to the `ICONS` object (after `file`):
```js
  key: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
```

Add a new item to the Supervisor `Cross-Outlet` group (inside the `if (isSupervisor.value)` block):
```js
        { label: 'Manager Access', to: '/supervisor/manager-access', icon: 'key' },
```
so that group's `items` array becomes:
```js
      items: [
        { label: 'All Outlets', to: '/supervisor', icon: 'grid' },
        { label: 'Staff Comparison', to: '/supervisor/staff-comparison', icon: 'users' },
        { label: 'Cluster Reports', to: '/supervisor/reports', icon: 'file' },
        { label: 'Manager Access', to: '/supervisor/manager-access', icon: 'key' },
      ],
```

- [ ] **Step 4: Build and manually verify**

```bash
cd lautan-academy-frontend
npm run build
```
Expected: no errors.

Start dev server, log in as Supervisor (real account), confirm "Manager Access" appears in the sidebar (and mobile bottom nav) and the page renders three role rows with working inputs. Do not actually submit a rotation here — that's covered against production in Task 8.

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-frontend
git add src/views/SupervisorManagerAccessView.vue src/router/index.js src/components/AppSidebar.vue
git commit -m "Add Supervisor Manager Access page for master PIN rotation"
```

---

### Task 8: Deploy and verify end-to-end against production

**Files:** none (deployment + verification only)

- [ ] **Step 1: Deploy backend**

```bash
cd lautan-academy-backend
railway up --detach
```
Wait for it to report success, then run the migration against production (same script as Task 1, but pointed at production — confirm `DATABASE_URL` in the deploy environment already ran it via Railway's build, or run it manually the same way Task 1 Step 2 did, against production).

- [ ] **Step 2: Deploy frontend**

```bash
cd lautan-academy
vercel --prod --yes
```

- [ ] **Step 3: Verify the live bundle contains the new code**

```bash
curl -s -L https://lautan-academy.vercel.app/ | grep -oE '/assets/index-[^"]+\.js'
```
Download that bundle and grep for a distinctive string, e.g. `"Register your outlet"` and `"Manager Access"`, confirming both are present (same verification pattern used throughout this session for every prior deploy).

- [ ] **Step 4: Full round-trip against production with a throwaway outlet**

Using the forged-JWT technique already established this session (mint locally with production's `JWT_SECRET`, call the live Railway URL directly):
1. Register a throwaway outlet (pick one not in real use, or coordinate with the user on a safe one to use briefly) with the real production master PIN and a test password.
2. Confirm login with the new password succeeds against production.
3. Confirm the old master PIN no longer works for that outlet.
4. Delete the test `manager_credentials` row directly via DB query (same cleanup pattern as Task 3).

- [ ] **Step 5: Report to the user for real-device testing**

Tell the user what was deployed and ask them to test the actual registration + login flow on their phone with a real outlet, since UI/UX behavior on a real device is the thing this session's established practice never trusts without a real test (see CLAUDE.md hard rule 3).

- [ ] **Step 6: Update SCOPE_TRACKER.md**

Only after the user confirms real-device testing passed — do not check anything off preemptively (CLAUDE.md hard rule 6). Add an entry to the running narrative at the end of `SCOPE_TRACKER.md`, following the same style as the existing entries for the Manage Staff mobile fix, PWA installability, and Assessment Review additions. Commit and push.
