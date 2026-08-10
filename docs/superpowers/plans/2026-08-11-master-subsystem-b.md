# Master Subsystem B — Supervisor PIN Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in Master User reset the Supervisor role's shared PIN (`manager_pins` where `role='supervisor'`) — the one role with no existing recovery path if its PIN is lost.

**Architecture:** One new backend route (`POST /auth/master-reset-supervisor-pin`, gated by the existing `requireMaster` middleware, no new tables), one new frontend panel wired into the existing `MasterPanel.vue`'s `pinReset` tab (currently a disabled placeholder), reusing the existing `PasswordField.vue` component and `masterAuth` Pinia store's token.

**Tech Stack:** Node.js + Express + `pg` + `bcrypt` (backend, `lautan-academy-backend`), Vue 3 + Pinia + `vue-i18n` (frontend, `lautan-academy-frontend/` inside this repo).

## Global Constraints

- No new dependencies — everything needed (`bcrypt`, `express`, `pg`, `vue-i18n`, `PasswordField.vue`) already exists in the repos.
- No test framework exists in either repo (no vitest/jest/mocha) — verification is curl (backend) + `npm run build` + manual browser click-through (frontend), matching every prior subsystem in this project. Do not add a test framework as part of this plan.
- Bilingual EN/MS required for every new user-facing string (project hard rule).
- New PIN validation: `length >= 6` (matches `rotate-master-pin`'s existing rule for `manager_pins`, for consistency across every write path into that table).
- Rate limiting: reuse the existing `rate_limits` table via `isLockedOut`/`recordFailure`/`clearFailures` from `middleware/rateLimit.js` — do not build a new counter mechanism.
- Match existing file conventions exactly (see `routes/auth.js`, `SupervisorManagerAccessView.vue` as the closest analog — same PIN-rotation shape, scoped to one role instead of three).

---

### Task 1: Backend — `POST /auth/master-reset-supervisor-pin` route

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\auth.js` (add new route after the existing `rotate-master-pin` route, around line 248)

**Interfaces:**
- Consumes: `requireMaster` (from `../middleware/auth.js`, already imported in this file), `isLockedOut`/`recordFailure`/`clearFailures` (from `../middleware/rateLimit.js`, already imported), `pool` (from `../config/db.js`, already imported), `bcrypt` (already imported).
- Produces: `POST /auth/master-reset-supervisor-pin` — request `{ newPin: string }` with header `Authorization: Bearer <master JWT>`, response `{ status: 'ok' }` or `{ status: 'error', error: string }`.

- [ ] **Step 1: Confirm the route doesn't exist yet (baseline check)**

Start the backend dev server if not already running:

```bash
cd C:\Users\Hafiz\projects\lautan-academy-backend
npm run dev
```

In a second terminal, get a real master token (use a real master username/password already seeded from Subsystem A):

```bash
curl -s -X POST http://localhost:3000/auth/master-login \
  -H "Content-Type: application/json" \
  -d '{"username":"<your-master-username>","password":"<your-master-password>"}'
```

Save the returned `token` value as `$MASTER_TOKEN` for the rest of this task. Then:

```bash
curl -s -X POST http://localhost:3000/auth/master-reset-supervisor-pin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MASTER_TOKEN" \
  -d '{"newPin":"TEST123"}'
```

Expected: `Cannot POST /auth/master-reset-supervisor-pin` (404) — confirms the route doesn't exist yet.

- [ ] **Step 2: Add the route**

Insert into `routes/auth.js` immediately after the existing `rotate-master-pin` route (after line 248, before the `master-login` route comment block):

```javascript
// Master-only: set a new shared PIN for the Supervisor role. Supervisor is
// the one role with no existing recovery path — rotate-master-pin and
// manager-register both explicitly exclude it (Supervisor is the one who
// grants those, so it can't grant itself). Gated by requireMaster alone,
// not requireScope — Master's own auth is sufficient proof, this doesn't
// touch manager_credentials or any other role's manager_pins row. See
// docs/superpowers/specs/2026-08-11-master-subsystem-b-design.md.
authRouter.post('/master-reset-supervisor-pin', requireMaster, async (req, res) => {
  const newPin = (req.body.newPin || '').toString();

  // Failures here are validation failures (bad input), not a wrong-guess —
  // still counted so a leaked/compromised master token can't be hammered
  // against this endpoint indefinitely. Keyed to the master username in
  // the JWT (scopeKey on a 'master' token), not shared with any other
  // counter.
  const failKey = `master_reset_supervisor_${req.session.scopeKey}`;
  if (await isLockedOut(failKey)) {
    return res.status(429).json({ status: 'error', error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  if (newPin.length < 6) {
    await recordFailure(failKey);
    return res.status(400).json({ status: 'error', error: 'PIN must be at least 6 characters.' });
  }
  await clearFailures(failKey);

  const pinHash = await bcrypt.hash(newPin, 10);
  await pool.query(
    `insert into manager_pins (role, pin_hash) values ('supervisor', $1)
     on conflict (role) do update set pin_hash = excluded.pin_hash`,
    [pinHash]
  );
  res.json({ status: 'ok' });
});
```

- [ ] **Step 3: Verify success path**

```bash
curl -s -X POST http://localhost:3000/auth/master-reset-supervisor-pin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MASTER_TOKEN" \
  -d '{"newPin":"TEST123"}'
```

Expected: `{"status":"ok"}`.

- [ ] **Step 4: Verify the new PIN actually works for Supervisor login, and the old one doesn't**

```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"supervisor","pin":"TEST123"}'
```

Expected: `{"authorized":true,"token":"..."}`.

If you know the PIN that was set before this test, confirm it now fails:

```bash
curl -s -X POST http://localhost:3000/auth/manager-login \
  -H "Content-Type: application/json" \
  -d '{"role":"supervisor","pin":"<old-pin>"}'
```

Expected: `{"authorized":false,"error":"Incorrect password."}`.

**Important — restore the Supervisor PIN afterward** if this is a shared dev/staging DB, since this test just changed it for real. Use `rotate-master-pin` or this new endpoint again to set it back to whatever the team actually uses, or coordinate with the user before running Step 3/4 against anything but a disposable local DB.

- [ ] **Step 5: Verify validation and gating**

Too-short PIN:
```bash
curl -s -X POST http://localhost:3000/auth/master-reset-supervisor-pin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MASTER_TOKEN" \
  -d '{"newPin":"abc"}'
```
Expected: `{"status":"error","error":"PIN must be at least 6 characters."}`, HTTP 400.

Non-master token (use any staff/manager token, or omit the header):
```bash
curl -s -X POST http://localhost:3000/auth/master-reset-supervisor-pin \
  -H "Content-Type: application/json" \
  -d '{"newPin":"TEST123"}'
```
Expected: `{"authorized":false,"error":"No session token."}`, HTTP 401.

Lockout (run the too-short-PIN request 5 times rapidly, then a 6th):
Expected: 6th response is `{"status":"error","error":"Too many attempts. Please wait a few minutes and try again."}`, HTTP 429.

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Hafiz\projects\lautan-academy-backend
git add src/routes/auth.js
git commit -m "feat: master can reset Supervisor's shared PIN"
```

---

### Task 2: Frontend — `api.masterResetSupervisorPin` client function

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\api\client.js:79` (add next to the existing `rotateMasterPin`/`masterLogin` entries)

**Interfaces:**
- Consumes: `request(path, options)` (defined in this same file, line 12 — already auto-attaches the *staff/manager* token from `localStorage['lautan_token']`, but accepts an `options.headers` override since it spreads `options.headers` last).
- Produces: `api.masterResetSupervisorPin(newPin, masterToken) => Promise<{status:'ok'} | {status:'error', error:string}>` — used by Task 4.

**Why an explicit token argument:** `request()`'s default `Authorization` header comes from `lautan_token` (the staff/manager session key), never `lautan_master_token`. Every existing Master call site works around this by not needing auth at all (`masterLogin` is pre-auth). This is the first *authenticated* Master API call in the codebase, so it must explicitly pass the master token via `options.headers` to override the default.

- [ ] **Step 1: Add the client function**

In `src/api/client.js`, immediately after the `masterLogin` entry (end of the `api` object, currently line 81):

```javascript
  masterResetSupervisorPin: (newPin, masterToken) =>
    request('/auth/master-reset-supervisor-pin', {
      method: 'POST',
      body: JSON.stringify({ newPin }),
      headers: { Authorization: `Bearer ${masterToken}` },
    }),
```

- [ ] **Step 2: Verify it compiles**

```bash
cd C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/api/client.js
git commit -m "feat: add masterResetSupervisorPin API client function"
```

---

### Task 3: Frontend — i18n strings (EN + MS)

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\en.json:492-515` (inside the existing `masterPanel` block)
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\ms.json:492-515` (same block, MS)

**Interfaces:**
- Produces: `masterPanel.pinReset.*` translation keys consumed by Task 4's component via `t('masterPanel.pinReset.<key>')`.

- [ ] **Step 1: Add EN keys**

In `en.json`, inside the `masterPanel` object, add a new `pinReset` object (alongside the existing `tab` object, e.g. right after it, before the closing `}` of `masterPanel` at line 515):

```json
    "pinReset": {
      "title": "Reset Supervisor PIN",
      "intro": "Set a new shared PIN for the Supervisor role. Supervisor has no self-service recovery path, so this is the only way to fix a lost Supervisor PIN. The current value can't be shown back, only replaced.",
      "newPinLabel": "New Supervisor PIN",
      "newPinPlaceholder": "New Supervisor PIN",
      "back": "Back",
      "saving": "Saving...",
      "set": "Set",
      "errorEnterPin": "Enter a new PIN.",
      "errorTooShort": "PIN must be at least 6 characters.",
      "successUpdated": "Supervisor PIN updated.",
      "errorUpdateFailed": "Could not update."
    }
```

- [ ] **Step 2: Add matching MS keys**

In `ms.json`, same location:

```json
    "pinReset": {
      "title": "Reset PIN Supervisor",
      "intro": "Tetapkan PIN baharu untuk peranan Supervisor. Supervisor tiada cara pemulihan sendiri, jadi ini satu-satunya cara membetulkan PIN Supervisor yang hilang. Nilai semasa tidak boleh dipaparkan semula, hanya boleh diganti.",
      "newPinLabel": "PIN Supervisor Baharu",
      "newPinPlaceholder": "PIN Supervisor Baharu",
      "back": "Kembali",
      "saving": "Menyimpan...",
      "set": "Tetapkan",
      "errorEnterPin": "Sila masukkan PIN baharu.",
      "errorTooShort": "PIN mesti sekurang-kurangnya 6 aksara.",
      "successUpdated": "PIN Supervisor telah dikemas kini.",
      "errorUpdateFailed": "Gagal mengemas kini."
    }
```

- [ ] **Step 3: Verify JSON is valid and key-parity holds**

```bash
cd C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend
node -e "const en=require('./src/i18n/locales/en.json'); const ms=require('./src/i18n/locales/ms.json'); const flatten=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v!==null?flatten(v,p+k+'.'):[p+k]); const a=flatten(en), b=flatten(ms); const missing=a.filter(k=>!b.includes(k)).concat(b.filter(k=>!a.includes(k))); console.log(missing.length===0 ? 'OK: key parity clean' : 'MISSING: '+missing.join(', '));"
```

Expected: `OK: key parity clean`.

- [ ] **Step 4: Commit**

```bash
git add lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "feat: add EN/MS strings for master Supervisor PIN reset"
```

---

### Task 4: Frontend — `MasterPinReset.vue` component

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterPinReset.vue`

**Interfaces:**
- Consumes: `api.masterResetSupervisorPin(newPin, masterToken)` (Task 2), `masterPanel.pinReset.*` i18n keys (Task 3), `useMasterAuthStore()` (existing, `src/store/masterAuth.js` — exposes `.token`), `PasswordField.vue` (existing, `src/components/PasswordField.vue`).
- Produces: emits `close` (goes back to the tab list — consumed by `MasterPanel.vue` in Task 5).

This mirrors `SupervisorManagerAccessView.vue`'s existing PIN-rotation pattern (same `PasswordField` + status-message shape), scoped to one PIN instead of a loop over three roles, and using the Master token instead of the Supervisor's own session.

- [ ] **Step 1: Write the component**

```vue
<script setup>
// Master-only: reset the Supervisor role's shared PIN. Mirrors
// SupervisorManagerAccessView.vue's rotate-PIN pattern (same PasswordField
// + status-message shape) but scoped to one PIN and authenticated with the
// Master token instead of a Supervisor session. See
// docs/superpowers/specs/2026-08-11-master-subsystem-b-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import PasswordField from './PasswordField.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const newPin = ref('')
const saving = ref(false)
const status = ref('')
const statusOk = ref(false)

async function submit() {
  status.value = ''
  statusOk.value = false
  const pin = newPin.value.trim()
  if (!pin) {
    status.value = t('masterPanel.pinReset.errorEnterPin')
    return
  }
  if (pin.length < 6) {
    status.value = t('masterPanel.pinReset.errorTooShort')
    return
  }
  saving.value = true
  try {
    const res = await api.masterResetSupervisorPin(pin, masterAuth.token)
    if (res.status !== 'ok') throw new Error(res.error || t('masterPanel.pinReset.errorUpdateFailed'))
    newPin.value = ''
    status.value = t('masterPanel.pinReset.successUpdated')
    statusOk.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.pinReset.errorUpdateFailed')
    statusOk.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="px-5 py-4 space-y-4">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.pinReset.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.pinReset.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.pinReset.intro') }}</p>
    </div>
    <form @submit.prevent="submit" class="space-y-2">
      <label for="master-pin-reset-input" class="sr-only">{{ t('masterPanel.pinReset.newPinLabel') }}</label>
      <PasswordField
        id="master-pin-reset-input"
        v-model="newPin"
        :placeholder="t('masterPanel.pinReset.newPinPlaceholder')"
        input-class="w-full border border-slate/30 rounded-lg py-2 pl-3 pr-9 text-sm"
      />
      <button
        type="submit"
        :disabled="saving"
        class="w-full bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {{ saving ? t('masterPanel.pinReset.saving') : t('masterPanel.pinReset.set') }}
      </button>
    </form>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
  </div>
</template>
```

- [ ] **Step 2: Verify it compiles**

```bash
cd C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend
npm run build
```

Expected: clean build (component isn't wired in yet, but must still compile standalone with no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterPinReset.vue
git commit -m "feat: add MasterPinReset component"
```

---

### Task 5: Frontend — wire into `MasterPanel.vue`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterPanel.vue`

**Interfaces:**
- Consumes: `MasterPinReset.vue` (Task 4, emits `close`).
- Produces: clicking the `pinReset` tab row now opens `MasterPinReset`; its `close` returns to the tab list (panel itself stays open — only `MasterPanel`'s own header `&times;` button or backdrop click emits the panel's own `close` to `MasterKeyButton.vue`, unchanged).

- [ ] **Step 1: Add view-state and swap logic**

Replace the full contents of `MasterPanel.vue` with:

```vue
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterPinReset from './MasterPinReset.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Subsystems C-H (see docs/superpowers/specs/2026-08-10-master-admin-
// subsystem-a-design.md) each fill one of these in — this round only
// pinReset is real, the rest stay disabled placeholders.
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']
const ENABLED_TABS = ['pinReset']

const activeTab = ref(null)

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

        <MasterPinReset v-if="activeTab === 'pinReset'" @close="activeTab = null" />

        <nav v-else class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <button
            v-for="tabKey in TABS"
            :key="tabKey"
            type="button"
            :disabled="!ENABLED_TABS.includes(tabKey)"
            @click="activeTab = tabKey"
            class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left"
            :class="ENABLED_TABS.includes(tabKey) ? 'text-ink hover:bg-seafoam' : 'text-slate/50 cursor-not-allowed'"
          >
            <span>{{ t(`masterPanel.tab.${tabKey}`) }}</span>
            <span v-if="!ENABLED_TABS.includes(tabKey)" class="text-[10px] uppercase tracking-wide">{{ t('masterPanel.comingSoon') }}</span>
          </button>
        </nav>

        <div v-if="activeTab === null" class="px-4 py-4 border-t border-seafoam">
          <button type="button" @click="handleLogout" class="w-full py-2.5 rounded-lg text-sm font-medium border border-slate/30 text-slate hover:border-coral hover:text-coral transition-colors">{{ t('masterPanel.logOut') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

Note: the Log Out footer is hidden while `MasterPinReset` is showing (`v-if="activeTab === null"`) — matches the tab list also being hidden, so the panel doesn't show two unrelated action areas stacked at once. `MasterPinReset`'s own "Back" link is the way out of that view.

- [ ] **Step 2: Verify build**

```bash
cd C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterPanel.vue
git commit -m "feat: wire PIN Reset tab into Master Panel"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start both dev servers**

```bash
cd C:\Users\Hafiz\projects\lautan-academy-backend
npm run dev
```

```bash
cd C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend
npm run dev
```

- [ ] **Step 2: Browser click-through (EN)**

Open the frontend dev URL. Click the Master key icon → log in with real Master credentials → Master Panel opens → click "PIN Reset" → enter a new PIN (≥6 chars) → Set → confirm the green success message appears ("Supervisor PIN updated."). Click Back → confirm the tab list + Log Out footer are back. Log out.

Then confirm the new PIN actually works: go to Supervisor login, log in with the new PIN — should succeed. Use `rotate-master-pin` (Supervisor's own existing "Manager Access" screen doesn't cover Supervisor itself, so if you need to restore a specific known PIN afterward for the team, use this same Master PIN Reset flow again to set it back).

- [ ] **Step 3: Browser click-through (MS)**

Switch language to BM (existing `LanguageSwitcher`), repeat the same flow, confirm every string in the PIN Reset panel renders in Bahasa Malaysia (no leftover English, no missing-key fallback showing the raw key path).

- [ ] **Step 4: Confirm password visibility toggle works**

On the PIN Reset field, click the eye icon — confirm it toggles the input between masked and plain text (this is `PasswordField.vue`'s existing behavior, being reused here — confirms it wasn't broken by this integration).

- [ ] **Step 5: Confirm session isolation**

While the Master Panel is open and a PIN reset succeeds, confirm no staff/manager session (`lautan_token`) was read or written — check `localStorage` in devtools before/after, only `lautan_master_token` should have changed (it doesn't change either, actually — only the DB row does. Confirm `lautan_token` is untouched.).

- [ ] **Step 6: Update MEMORY.md and SCOPE_TRACKER.md**

Per CLAUDE.md hard rule 5: after verifying end-to-end, append a brief outcome summary to `MEMORY.md`'s Master Subsystem B line (update the `- B. ...` bullet from "ON HOLD" to done, with commit refs from Tasks 1-5), and note this in `SCOPE_TRACKER.md` if it tracks Master subsystems (check first — it may not yet, in which case skip). Prompt the user to `/clear` per rule 5.
