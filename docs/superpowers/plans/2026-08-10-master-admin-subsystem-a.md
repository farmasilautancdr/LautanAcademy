# Master User Subsystem A — Role, Auth, Panel Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a `master` role fully independent of the existing staff/manager auth model — a `master_users` table, a CLI-only seed script, a `/auth/master-login` endpoint issuing a short-lived scoped JWT, and a frontend Key icon + empty panel shell that subsystems B-H will fill in later.

**Architecture:** Backend: a new table + one new auth endpoint + one new middleware, following the exact patterns `manager-login`/`manager_pins` already establish (bcrypt, `rate_limits`-backed lockout, JWT `scopeType`). Frontend: a self-contained `MasterKeyButton` component (icon + login modal + panel drawer, own Pinia store, own localStorage key) dropped into the 6 existing standalone login/register views and `AppSidebar.vue` — it never reads or writes the existing `auth` store, so it can't disturb whatever staff/manager session is active.

**Tech Stack:** No new dependencies. Backend: existing `bcrypt`, `jsonwebtoken`, `pg`, Node's built-in `readline/promises` for the CLI script. Frontend: existing Vue 3 Composition API, Pinia, vue-i18n, Tailwind — hand-authored inline SVG icon (matching `AppSidebar.vue`'s existing `ICONS` pattern), not an icon library.

## Global Constraints

- No new frameworks/libraries without asking first (CLAUDE.md hard rule) — this plan introduces none.
- Bilingual EN/MS required for every user-facing string (CLAUDE.md hard rule) — every new UI string gets both.
- This project has **no automated test framework** in either repo (confirmed: no `vitest`/`jest` in `lautan-academy-frontend/package.json`, no test script in `lautan-academy-backend/package.json`). Every task below verifies with `curl` (backend) or `npm run build` + manual browser check (frontend) instead of a unit-test step — this matches the project's actual established practice (see MEMORY.md's `[CAVEAT]`), not a shortcut.
- Two separate git repos: backend tasks commit inside `lautan-academy-backend` (sibling folder, its own repo); frontend tasks commit inside `lautan-academy` (this repo, files under `lautan-academy-frontend/`). Don't mix a `git add`/`git commit` across the two.
- Password hashing: `bcrypt.hash(x, 10)` — matches every existing call site in this codebase (`routes/auth.js`, `scripts/seed.js`). Don't introduce a different cost factor.
- Spec: `docs/superpowers/specs/2026-08-10-master-admin-subsystem-a-design.md` — every task below implements a specific section of it; re-read it if a task's reasoning is unclear.

---

## Part 1 — Backend (`lautan-academy-backend`)

### Task 1: `master_users` table migration script

**Files:**
- Create: `scripts/migrate-add-master-users.js`

**Interfaces:**
- Consumes: `pool` from `src/config/db.js` (existing, default export is named `pool`).
- Produces: `master_users` table — `id bigserial`, `username text unique not null`, `password_hash text not null`, `created_at timestamptz not null default now()`. Task 2 and Task 4 both depend on this exact shape.

- [ ] **Step 1: Write the migration script**

```js
// scripts/migrate-add-master-users.js
// One-off: creates master_users for the Master User / Super Admin role —
// see docs/superpowers/specs/2026-08-10-master-admin-subsystem-a-design.md.
// Fully independent of staff_roster/manager_pins/manager_credentials — the
// Master role is not scoped to any outlet/region. Safe to re-run.
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`
    create table if not exists master_users (
      id bigserial primary key,
      username text unique not null,
      password_hash text not null,
      created_at timestamptz not null default now()
    )
  `);
  console.log('Migration complete: master_users table created.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against local dev DB**

Run: `node scripts/migrate-add-master-users.js`
Expected output: `Migration complete: master_users table created.`

- [ ] **Step 3: Verify the table shape**

Run: `node -e "import('./src/config/db.js').then(({pool}) => pool.query(\"select column_name, data_type from information_schema.columns where table_name = 'master_users' order by ordinal_position\").then(r => { console.log(r.rows); pool.end(); }))"`
Expected: 4 rows — `id`/`bigint`, `username`/`text`, `password_hash`/`text`, `created_at`/`timestamp with time zone`.

- [ ] **Step 4: Re-run to confirm idempotency**

Run: `node scripts/migrate-add-master-users.js` again.
Expected: same success message, no error (proves `create table if not exists` doesn't fail on a second run).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-add-master-users.js
git commit -m "feat: add master_users table for Master User role"
```

---

### Task 2: CLI seed script — `create-master-user.js`

**Files:**
- Create: `scripts/create-master-user.js`

**Interfaces:**
- Consumes: `master_users` table (Task 1), `pool` from `src/config/db.js`, `bcrypt` (existing dependency).
- Produces: rows in `master_users` with a bcrypt-hashed password. Task 4's `/auth/master-login` reads this exact table/column shape.

- [ ] **Step 1: Write the script**

```js
// scripts/create-master-user.js
// Interactive-only CLI to create or reset a Master User. Prompts instead
// of taking username/password as argv so the password never lands in
// shell history or a process listing. Re-running with the same username
// overwrites its password — same "overwrite is the reset path"
// convention as manager-register/rotate-master-pin. This is the ONLY way
// to create a Master User — no in-app UI exists by design (see the spec's
// "Decisions" section on why).
import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import bcrypt from 'bcrypt';
import { pool } from '../src/config/db.js';

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const username = (await rl.question('Master username: ')).trim();
  const password = await rl.question('Master password: ');
  rl.close();

  if (!username) throw new Error('Username cannot be empty.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `insert into master_users (username, password_hash) values ($1, $2)
     on conflict (username) do update set password_hash = excluded.password_hash`,
    [username, passwordHash]
  );
  console.log(`Master user "${username}" created/updated.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run it and create a throwaway test account**

Run: `node scripts/create-master-user.js`, enter username `test_master_a1b2`, password `throwaway-test-pw-1` at the prompts.
Expected output: `Master user "test_master_a1b2" created/updated.`

- [ ] **Step 3: Confirm the row exists with a real hash (not plaintext)**

Run: `node -e "import('./src/config/db.js').then(({pool}) => pool.query(\"select username, password_hash from master_users where username = 'test_master_a1b2'\").then(r => { console.log(r.rows); pool.end(); }))"`
Expected: one row, `password_hash` starts with `$2b$` (bcrypt), is not the literal string `throwaway-test-pw-1`.

- [ ] **Step 4: Confirm re-running overwrites, doesn't duplicate**

Run: `node scripts/create-master-user.js` again with the same username `test_master_a1b2`, a different password `throwaway-test-pw-2`.
Then run: `node -e "import('./src/config/db.js').then(({pool}) => pool.query(\"select count(*) from master_users where username = 'test_master_a1b2'\").then(r => { console.log(r.rows); pool.end(); }))"`
Expected: `count` is `1`, not `2`.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-master-user.js
git commit -m "feat: add CLI script to create/reset Master User accounts"
```

(Leave the `test_master_a1b2` row in place — Task 4 reuses it for the login endpoint test, deleted at the end of that task.)

---

### Task 3: `issueMasterToken` + `requireMaster` middleware

**Files:**
- Modify: `src/middleware/auth.js`

**Interfaces:**
- Consumes: `jwt` (existing import), `env.jwtSecret` (existing).
- Produces: `issueMasterToken(username)` → JWT string, `scopeType: 'master'`, `scopeKey: username`, 2h expiry. `requireMaster` → Express middleware, 403s unless `req.session.scopeType === 'master'`. Task 4 uses `issueMasterToken`; subsystems B-H use `requireMaster` on every Master-only route.

- [ ] **Step 1: Add both exports**

Add after the existing `issueToken` function (`src/middleware/auth.js`, currently ends around line 6):

```js
// Separate signer from issueToken: shorter expiry since this is an
// elevated-privilege session, not a daily-driver login. See
// docs/superpowers/specs/2026-08-10-master-admin-subsystem-a-design.md.
export function issueMasterToken(username) {
  return jwt.sign({ scopeType: 'master', scopeKey: username }, env.jwtSecret, { expiresIn: '2h' });
}
```

Add after the existing `requireScope` function (end of file):

```js
// Strict single-scope check for Master-only routes (subsystems B-H build
// on this). requireScope('master') would also work, but this reads more
// clearly at every Master-only call site.
export function requireMaster(req, res, next) {
  if (req.session?.scopeType !== 'master') {
    return res.status(403).json({ authorized: false, error: 'Not authorized for this action.' });
  }
  next();
}
```

- [ ] **Step 2: Confirm the file still parses**

Run: `node --check src/middleware/auth.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/middleware/auth.js
git commit -m "feat: add issueMasterToken and requireMaster middleware"
```

---

### Task 4: `POST /auth/master-login` endpoint

**Files:**
- Modify: `src/routes/auth.js`

**Interfaces:**
- Consumes: `issueMasterToken` + `requireMaster` (Task 3), `isLockedOut`/`recordFailure`/`clearFailures` (existing, `middleware/rateLimit.js`), `master_users` table (Task 1/2).
- Produces: `POST /auth/master-login` — request `{ username, password }`, response `{ authorized: true, token }` or `{ authorized: false, error }`. Frontend Task 5 (`api.masterLogin`) calls this exact endpoint/shape.

- [ ] **Step 1: Update the import line**

Change (top of `src/routes/auth.js`):
```js
import { issueToken, requireAuth, requireScope } from '../middleware/auth.js';
```
to:
```js
import { issueToken, issueMasterToken, requireAuth, requireMaster, requireScope } from '../middleware/auth.js';
```

- [ ] **Step 2: Add the endpoint**

Add at the end of `src/routes/auth.js`, after the existing `rotate-master-pin` handler:

```js
// Master User login — fully independent of staff/manager auth (no
// scope_key/outlet, no relation to manager_pins/manager_credentials).
// See docs/superpowers/specs/2026-08-10-master-admin-subsystem-a-design.md.
authRouter.post('/master-login', async (req, res) => {
  const username = (req.body.username || '').toString().trim();
  const password = (req.body.password || '').toString();

  const failKey = `master_${username}`;
  if (await isLockedOut(failKey)) {
    return res.status(429).json({ authorized: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  const { rows } = await pool.query('select password_hash from master_users where username = $1', [username]);
  const match = rows[0];
  const ok = match && password && await bcrypt.compare(password, match.password_hash);
  if (!ok) {
    await recordFailure(failKey);
    return res.json({ authorized: false, error: 'Incorrect username or password.' });
  }
  await clearFailures(failKey);

  const token = issueMasterToken(username);
  res.json({ authorized: true, token });
});
```

- [ ] **Step 3: Start the backend locally**

Run: `npm run dev` (leave running in another terminal/background).
Expected: `lautan-academy-backend listening on :3000`.

- [ ] **Step 4: Verify correct login succeeds**

Run: `curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"test_master_a1b2","password":"throwaway-test-pw-2"}'`
(Use whichever password Task 2's Step 4 last set for this account.)
Expected: `{"authorized":true,"token":"..."}`.

- [ ] **Step 5: Verify the token decodes correctly**

Run: `node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1], 'base64url').toString()))" "<paste the token from Step 4>"`
Expected: object containing `scopeType: 'master'`, `scopeKey: 'test_master_a1b2'`, and `exp` roughly 2 hours (7200s) after `iat`.

- [ ] **Step 6: Verify wrong password fails**

Run: `curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"test_master_a1b2","password":"wrong-password"}'`
Expected: `{"authorized":false,"error":"Incorrect username or password."}`.

- [ ] **Step 7: Verify lockout triggers after 5 failures**

Run the Step 6 command 4 more times (5 total wrong attempts), then once more.
Expected: the 6th response is `429` with `{"authorized":false,"error":"Too many attempts. Please wait a few minutes and try again."}`.

- [ ] **Step 8: Verify `requireMaster` actually gates (temporary route)**

Temporarily add this line directly after the `master-login` handler in `src/routes/auth.js`:
```js
authRouter.get('/master-test-temp', requireAuth, requireMaster, (req, res) => res.json({ ok: true }));
```
Restart the dev server (or let `--watch` pick it up). Then:

Run: `curl -s http://localhost:3000/auth/master-test-temp -H "Authorization: Bearer <a staff or manager token, e.g. from a real /auth/staff-login or /auth/manager-login call>"`
Expected: `403 {"authorized":false,"error":"Not authorized for this action."}`.

Run: `curl -s http://localhost:3000/auth/master-test-temp -H "Authorization: Bearer <the master token from Step 4>"`
Expected: `200 {"ok":true}`.

Then **remove** the temporary `master-test-temp` line — it must not be committed.

- [ ] **Step 9: Clean up the throwaway test account**

Run: `node -e "import('./src/config/db.js').then(({pool}) => pool.query(\"delete from master_users where username = 'test_master_a1b2'\").then(() => { console.log('cleaned up'); pool.end(); }))"`
Expected: `cleaned up`.

- [ ] **Step 10: Commit**

```bash
git add src/routes/auth.js
git commit -m "feat: add POST /auth/master-login"
```

---

## Part 2 — Frontend (`lautan-academy-frontend`, inside the `lautan-academy` repo)

### Task 5: `api.masterLogin`

**Files:**
- Modify: `src/api/client.js`

**Interfaces:**
- Consumes: existing `request()` helper (unchanged — the login call needs no auth header, and `request()` attaching whatever `lautan_token` happens to exist is harmless since `/auth/master-login` never reads it).
- Produces: `api.masterLogin(username, password)` → `Promise<{ authorized, token? , error? }>`. Task 6's store depends on this exact call.

- [ ] **Step 1: Add the call**

Add inside the `export const api = { ... }` object in `src/api/client.js`, after the existing `rotateMasterPin` entry:

```js
  masterLogin: (username, password) =>
    request('/auth/master-login', { method: 'POST', body: JSON.stringify({ username, password }) }),
```

- [ ] **Step 2: Verify the file still parses**

Run (from `lautan-academy-frontend/`): `node --check src/api/client.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/api/client.js
git commit -m "feat: add api.masterLogin"
```

---

### Task 6: `masterAuth` Pinia store

**Files:**
- Create: `src/store/masterAuth.js`

**Interfaces:**
- Consumes: `api.masterLogin` (Task 5).
- Produces: `useMasterAuthStore()` — state `token`, getter `isMasterLoggedIn`, actions `login(username, password)` (throws on failure, matches `useAuthStore`'s existing convention) and `logout()`. Tasks 8-10 depend on this exact store shape. File placed in `src/store/` (not `src/stores/`) to match the existing `src/store/auth.js` folder name exactly.

- [ ] **Step 1: Write the store**

```js
// src/store/masterAuth.js
// Fully independent of useAuthStore (src/store/auth.js) — separate
// localStorage key, separate state, never read or written by the
// existing staff/manager session. Opening/closing the Master Panel must
// never disturb whatever role session (if any) is active. See
// docs/superpowers/specs/2026-08-10-master-admin-subsystem-a-design.md.
import { defineStore } from 'pinia'
import { api } from '../api/client'

export const useMasterAuthStore = defineStore('masterAuth', {
  state: () => ({
    token: localStorage.getItem('lautan_master_token') || null,
  }),

  getters: {
    isMasterLoggedIn: (state) => !!state.token,
  },

  actions: {
    async login(username, password) {
      const data = await api.masterLogin(username, password)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      localStorage.setItem('lautan_master_token', data.token)
    },

    logout() {
      this.token = null
      localStorage.removeItem('lautan_master_token')
    },
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add lautan-academy-frontend/src/store/masterAuth.js
git commit -m "feat: add masterAuth Pinia store"
```

(Verified together with the UI in Task 13 — no standalone test harness exists to exercise a Pinia store in isolation in this project.)

---

### Task 7: i18n keys — `masterPanel` namespace

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ms.json`

**Interfaces:**
- Produces: a new top-level `masterPanel` key in both locale files, consumed by Tasks 8 and 9 via `t('masterPanel.xxx')`.

- [ ] **Step 1: Add the English keys**

In `src/i18n/locales/en.json`, the file currently ends with the `supervisorManagerAccessView` object's closing `  }\n}`. Change the very last two lines from:
```json
  }
}
```
to:
```json
  },
  "masterPanel": {
    "loginTitle": "Master Login",
    "username": "Username",
    "password": "Password",
    "cancel": "Cancel",
    "logIn": "Log In",
    "checking": "Checking...",
    "errorMissingFields": "Enter a username and password.",
    "errorInvalidLogin": "Incorrect username or password.",
    "panelTitle": "Master Panel",
    "close": "Close",
    "comingSoon": "Coming Soon",
    "logOut": "Log Out",
    "tab": {
      "pinReset": "PIN Reset",
      "overrides": "Permission Overrides",
      "dataPurge": "Data Purge",
      "maintenanceMode": "Maintenance Mode",
      "auditLogs": "Audit Logs",
      "backupExport": "Backup & Export",
      "sessions": "Active Sessions",
      "impersonation": "View As"
    }
  }
}
```

- [ ] **Step 2: Add the matching Bahasa Malaysia keys**

In `src/i18n/locales/ms.json`, same edit — change the final:
```json
  }
}
```
to:
```json
  },
  "masterPanel": {
    "loginTitle": "Log Masuk Master",
    "username": "Nama Pengguna",
    "password": "Kata Laluan",
    "cancel": "Batal",
    "logIn": "Log Masuk",
    "checking": "Menyemak...",
    "errorMissingFields": "Sila isi nama pengguna dan kata laluan.",
    "errorInvalidLogin": "Nama pengguna atau kata laluan salah.",
    "panelTitle": "Panel Master",
    "close": "Tutup",
    "comingSoon": "Akan Datang",
    "logOut": "Log Keluar",
    "tab": {
      "pinReset": "Reset PIN",
      "overrides": "Override Kebenaran",
      "dataPurge": "Padam Data Ujian",
      "maintenanceMode": "Mod Penyelenggaraan",
      "auditLogs": "Log Audit",
      "backupExport": "Sandaran & Eksport",
      "sessions": "Sesi Aktif",
      "impersonation": "Lihat Sebagai"
    }
  }
}
```

- [ ] **Step 3: Verify both files are valid JSON**

Run (from `lautan-academy-frontend/`): `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json')); JSON.parse(require('fs').readFileSync('src/i18n/locales/ms.json')); console.log('both valid')"`
Expected: `both valid`.

- [ ] **Step 4: Verify EN/BM key parity for the new namespace**

Run: `node -e "
const en=require('./src/i18n/locales/en.json').masterPanel;
const ms=require('./src/i18n/locales/ms.json').masterPanel;
const flat = o => Object.keys(o).flatMap(k => typeof o[k]==='object' ? Object.keys(o[k]).map(kk=>k+'.'+kk) : [k]);
const a=flat(en), b=flat(ms);
console.log('en-only:', a.filter(k=>!b.includes(k)));
console.log('ms-only:', b.filter(k=>!a.includes(k)));
"`
Expected: both arrays empty.

- [ ] **Step 5: Commit**

```bash
git add lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "feat: add masterPanel i18n keys (EN/BM)"
```

---

### Task 8: `MasterLoginModal.vue`

**Files:**
- Create: `src/components/MasterLoginModal.vue`

**Interfaces:**
- Consumes: `useMasterAuthStore` (Task 6), `masterPanel.*` i18n keys (Task 7).
- Produces: emits `close` and `success` (no props). Task 10 renders this component and listens for both events.

- [ ] **Step 1: Write the component**

```vue
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close', 'success'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = t('masterPanel.errorMissingFields')
    return
  }
  loading.value = true
  try {
    await masterAuth.login(username.value.trim(), password.value)
    password.value = ''
    emit('success')
  } catch (err) {
    error.value = t('masterPanel.errorInvalidLogin')
    password.value = ''
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" @click.self="emit('close')">
      <div class="w-full max-w-sm bg-white rounded-xl2 p-6 shadow-lg border border-seafoam">
        <h2 class="font-display font-semibold text-ink text-lg mb-4">{{ t('masterPanel.loginTitle') }}</h2>
        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-ink mb-1.5">{{ t('masterPanel.username') }}</label>
            <input v-model="username" type="text" autocomplete="off" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1.5">{{ t('masterPanel.password') }}</label>
            <input v-model="password" type="password" autocomplete="off" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua" />
          </div>
          <p v-if="error" class="text-coral text-sm">{{ error }}</p>
          <div class="flex gap-2">
            <button type="button" @click="emit('close')" class="flex-1 py-2.5 rounded-lg text-sm font-medium border border-slate/30 text-slate hover:border-aqua/50">{{ t('masterPanel.cancel') }}</button>
            <button type="submit" :disabled="loading" class="flex-1 bg-aqua text-white font-medium py-2.5 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60">{{ loading ? t('masterPanel.checking') : t('masterPanel.logIn') }}</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterLoginModal.vue
git commit -m "feat: add MasterLoginModal component"
```

(Rendered/verified together with Task 10 — no isolated component test harness in this project.)

---

### Task 9: `MasterPanel.vue`

**Files:**
- Create: `src/components/MasterPanel.vue`

**Interfaces:**
- Consumes: `useMasterAuthStore` (Task 6), `masterPanel.*` i18n keys (Task 7).
- Produces: emits `close` (no props). Task 10 renders this component and listens for `close`.

- [ ] **Step 1: Write the component**

```vue
<script setup>
import { useI18n } from 'vue-i18n'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Subsystems B-H (see docs/superpowers/specs/2026-08-10-master-admin-
// subsystem-a-design.md) each fill one of these in — this round they're
// all disabled placeholders.
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']

function handleLogout() {
  masterAuth.logout()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex justify-end bg-ink/40" @click.self="emit('close')">
      <div class="w-full max-w-sm h-full bg-white shadow-lg flex flex-col">
        <div class="px-5 py-4 border-b border-seafoam flex items-center justify-between">
          <h2 class="font-display font-semibold text-ink text-lg">{{ t('masterPanel.panelTitle') }}</h2>
          <button type="button" @click="emit('close')" class="text-slate hover:text-ink text-xl leading-none" :aria-label="t('masterPanel.close')">&times;</button>
        </div>
        <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <div v-for="tabKey in TABS" :key="tabKey" class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-slate/50 cursor-not-allowed">
            <span>{{ t(`masterPanel.tab.${tabKey}`) }}</span>
            <span class="text-[10px] uppercase tracking-wide">{{ t('masterPanel.comingSoon') }}</span>
          </div>
        </nav>
        <div class="px-4 py-4 border-t border-seafoam">
          <button type="button" @click="handleLogout" class="w-full py-2.5 rounded-lg text-sm font-medium border border-slate/30 text-slate hover:border-coral hover:text-coral transition-colors">{{ t('masterPanel.logOut') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterPanel.vue
git commit -m "feat: add MasterPanel shell component"
```

(Rendered/verified together with Task 10.)

---

### Task 10: `MasterKeyButton.vue`

**Files:**
- Create: `src/components/MasterKeyButton.vue`

**Interfaces:**
- Consumes: `useMasterAuthStore.isMasterLoggedIn` (Task 6), `MasterLoginModal` (Task 8), `MasterPanel` (Task 9).
- Produces: a single drop-in `<MasterKeyButton />` component, no props/events. Tasks 11 and 12 place this component into the app shell.

- [ ] **Step 1: Write the component**

```vue
<script setup>
import { ref } from 'vue'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterLoginModal from './MasterLoginModal.vue'
import MasterPanel from './MasterPanel.vue'

const masterAuth = useMasterAuthStore()
const showLogin = ref(false)
const showPanel = ref(false)

function handleClick() {
  if (masterAuth.isMasterLoggedIn) showPanel.value = true
  else showLogin.value = true
}

function handleLoginSuccess() {
  showLogin.value = false
  showPanel.value = true
}
</script>

<template>
  <button type="button" @click="handleClick" class="text-slate hover:text-aqua transition-colors shrink-0" aria-label="Master Panel">
    <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  </button>
  <MasterLoginModal v-if="showLogin" @close="showLogin = false" @success="handleLoginSuccess" />
  <MasterPanel v-if="showPanel" @close="showPanel = false" />
</template>
```

- [ ] **Step 2: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterKeyButton.vue
git commit -m "feat: add MasterKeyButton component"
```

---

### Task 11: Wire `MasterKeyButton` into `AppSidebar.vue`

**Files:**
- Modify: `src/components/AppSidebar.vue`

**Interfaces:**
- Consumes: `MasterKeyButton` (Task 10).

- [ ] **Step 1: Import it**

Add near the top of `<script setup>` in `AppSidebar.vue`, after the existing `import LanguageSwitcher from './LanguageSwitcher.vue'`:
```js
import MasterKeyButton from './MasterKeyButton.vue'
```

- [ ] **Step 2: Add it beside the desktop header's LanguageSwitcher**

Change:
```html
      <LanguageSwitcher />
    </div>
```
(the line right after the `subtitle` paragraph, inside the `px-5 py-6` header div) to:
```html
      <div class="flex items-center gap-2">
        <MasterKeyButton />
        <LanguageSwitcher />
      </div>
    </div>
```

- [ ] **Step 3: Add it to the mobile bottom nav, beside the existing logout button**

Change the mobile `<nav>`'s closing logout button block from:
```html
    <button type="button" @click="handleLogout" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-0 text-slate" :aria-label="t('sidebar.logOut')">
      <svg viewBox="0 0 24 24" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="ICONS.logout" />
      </svg>
      <span class="text-[10px] font-medium">{{ t('sidebar.logOut') }}</span>
    </button>
  </nav>
```
to:
```html
    <button type="button" @click="handleLogout" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-0 text-slate" :aria-label="t('sidebar.logOut')">
      <svg viewBox="0 0 24 24" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="ICONS.logout" />
      </svg>
      <span class="text-[10px] font-medium">{{ t('sidebar.logOut') }}</span>
    </button>
    <div class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-0">
      <MasterKeyButton />
    </div>
  </nav>
```

- [ ] **Step 4: Commit**

```bash
git add lautan-academy-frontend/src/components/AppSidebar.vue
git commit -m "feat: add MasterKeyButton to AppSidebar (desktop + mobile)"
```

(Rendered/verified in Task 13 — this project's frontend has no component test harness; visual/behavioral checks happen in the browser.)

---

### Task 12: Wire `MasterKeyButton` into the 6 standalone login/register views

**Files:**
- Modify: `src/views/LoginView.vue`
- Modify: `src/views/ManagerLoginView.vue`
- Modify: `src/views/AreaManagerLoginView.vue`
- Modify: `src/views/SupervisorLoginView.vue`
- Modify: `src/views/ManagerRegisterView.vue`
- Modify: `src/views/AreaManagerRegisterView.vue`

**Interfaces:**
- Consumes: `MasterKeyButton` (Task 10).

All 6 files share the exact same pattern — verified by grep before writing this plan. For each file:

- [ ] **Step 1: Add the import**

Add directly after the existing `import LanguageSwitcher from '../components/LanguageSwitcher.vue'` line in each file:
```js
import MasterKeyButton from '../components/MasterKeyButton.vue'
```

- [ ] **Step 2: Add the button beside `<LanguageSwitcher />`**

Each of the 6 files has this exact block in its template:
```html
      <div class="flex justify-end mb-2">
        <LanguageSwitcher />
      </div>
```
Change it to:
```html
      <div class="flex justify-end items-center gap-2 mb-2">
        <MasterKeyButton />
        <LanguageSwitcher />
      </div>
```

- [ ] **Step 3: Repeat Steps 1-2 for all 6 files**

File list (all confirmed to have the identical block above): `LoginView.vue`, `ManagerLoginView.vue`, `AreaManagerLoginView.vue`, `SupervisorLoginView.vue`, `ManagerRegisterView.vue`, `AreaManagerRegisterView.vue`.

- [ ] **Step 4: Commit**

```bash
git add lautan-academy-frontend/src/views/LoginView.vue lautan-academy-frontend/src/views/ManagerLoginView.vue lautan-academy-frontend/src/views/AreaManagerLoginView.vue lautan-academy-frontend/src/views/SupervisorLoginView.vue lautan-academy-frontend/src/views/ManagerRegisterView.vue lautan-academy-frontend/src/views/AreaManagerRegisterView.vue
git commit -m "feat: add MasterKeyButton to all 6 standalone login/register views"
```

---

### Task 13: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build check**

Run (from `lautan-academy-frontend/`): `npm run build`
Expected: builds clean, no errors.

- [ ] **Step 2: Create a real (non-test-prefixed) throwaway Master account for browser testing**

In the backend repo: `node scripts/create-master-user.js`, username `browsertest`, password `browser-test-pw-1`.

- [ ] **Step 3: Browser check — icon placement**

Start both dev servers (`npm run dev` in each repo). Open the frontend. Confirm the Key icon (a key-shaped outline, distinct from the existing lock-shaped `key` icon already used for Supervisor's Manager Access nav item) appears:
- On `/login`, `/manager-login`, `/area-manager-login`, `/supervisor-login`, `/manager-register`, `/area-manager-register` — beside the EN/BM toggle.
- Logged in as staff (or any manager role) on desktop viewport — in `AppSidebar.vue`'s header, beside the EN/BM toggle.
- Logged in as staff (or any manager role) on a mobile-width viewport (browser devtools responsive mode, <768px) — in the bottom icon bar, beside Logout.

- [ ] **Step 4: Browser check — login → panel flow**

Click the Key icon anywhere. Confirm the login modal opens. Submit with wrong credentials — confirm the inline error shows (`masterPanel.errorInvalidLogin`, both EN and BM after toggling). Submit with `browsertest` / `browser-test-pw-1` — confirm the modal closes and the panel slide-over opens showing all 8 tabs (PIN Reset, Permission Overrides, Data Purge, Maintenance Mode, Audit Logs, Backup & Export, Active Sessions, View As) each visibly disabled with a "Coming Soon" tag.

- [ ] **Step 5: Browser check — session isolation**

While logged in as a real staff/manager account AND master-logged-in (from Step 4), refresh the page. Confirm you're still logged in as that staff/manager (their dashboard shows, not kicked to a login screen) — proves the master token living in a separate localStorage key didn't interfere with the existing session.

- [ ] **Step 6: Browser check — logout**

Click Logout inside the Master Panel. Confirm the panel closes. Click the Key icon again — confirm it re-prompts the login modal (not straight to the panel), proving the master token was actually cleared. Separately confirm the staff/manager session (if one was active) is still intact — proves master logout didn't touch it.

- [ ] **Step 7: Browser check — both languages**

Toggle EN/BM (via the switcher beside the Key icon) with the login modal open, then with the panel open. Confirm every string in both (title, field labels, buttons, all 8 tab names, "Coming Soon", errors) renders correctly in both languages with no missing-key fallback text (a raw key like `masterPanel.tab.pinReset` showing instead of translated text would mean a typo in Task 7).

- [ ] **Step 8: Clean up the browser-test account**

In the backend repo: `node -e "import('./src/config/db.js').then(({pool}) => pool.query(\"delete from master_users where username = 'browsertest'\").then(() => { console.log('cleaned up'); pool.end(); }))"`

- [ ] **Step 9: Update MEMORY.md**

Replace the `[ACTIVE TASK]: Master User / Super Admin role + Control Panel` block's "STARTING NOW" line for subsystem A with a completion note (mirrors this project's established pattern for closing out a batch — see the i18n Phase 2 batch entries for the format), listing what got verified and how, and note subsystems B-H remain not started.

- [ ] **Step 10: Commit the MEMORY.md update**

```bash
git add MEMORY.md
git commit -m "docs: close out Master User subsystem A — verified live"
```
