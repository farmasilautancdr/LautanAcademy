# Master Subsystem F: DB Backup/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click full-DB export from the Master Control Panel — Master downloads a data-only SQL dump of all 14 real tables straight from the browser.

**Architecture:** New backend route hand-rolls `INSERT INTO` statements per table via the existing `pg` driver (no `pg_dump` binary available on Railway, no new dependency). New frontend panel fetches it as a `Blob` (with the master JWT in the `Authorization` header — plain links can't carry that) and triggers a browser download via a temporary object URL.

**Tech Stack:** Node.js/Express/`pg` (backend), Vue 3 + `vue-i18n` (frontend). No new dependencies either side.

## Global Constraints

- No `pg_dump` / Postgres client binaries available in the backend's Railway deploy image — dump must be generated in JS via the `pg` driver already installed. (Spec: "Constraints found during design".)
- Table whitelist is exactly these 14, hardcoded, in this order: `staff_roster`, `manager_pins`, `manager_credentials`, `content`, `results`, `wrong_answers`, `reports`, `ai_results`, `ai_wrong_answers`, `ai_quizzes`, `standard_questions`, `master_users`, `audit_log`, `system_settings`. Excludes `rate_limits` (ephemeral) and the confirmed-unused leftover schema (`topics`/`quizzes`/`attempts`/`attempt_answers`/`outlets`/`staff`/`resources`/`manager_reviews`).
- Data-only dump (`INSERT INTO` statements, no `CREATE TABLE`) — restore assumes `sql/schema.sql` is already applied, matching this project's existing convention.
- Route is `requireAuth` + `requireMaster` only — **not** logged to `audit_log` (explicit user decision: read-only, not account-management, matches Subsystem E's stated scope).
- Bilingual EN/MS strings required for all new UI text, following the exact key-nesting pattern already used under `masterPanel.*` in `src/i18n/locales/{en,ms}.json`.
- No test framework exists in either repo (backend or frontend) — verification is `curl` + `npm run build` + live browser click-through, matching every prior Master subsystem (A–E).
- This project is a single git repo rooted at `C:\Users\Hafiz\projects\lautan-academy`; the backend lives in the sibling directory `C:\Users\Hafiz\projects\lautan-academy-backend` (separate repo — commits there are independent of this repo's commits), the frontend lives in `lautan-academy-frontend/` inside this repo.

---

## Task 1: Backend — `/master/backup-export` route

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\masterBackup.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\index.js`

**Interfaces:**
- Consumes: `pool` from `../config/db.js` (existing, exports a `pg` `Pool` instance used identically in every other route file — see `src/routes/masterPurge.js:2`); `requireAuth`, `requireMaster` from `../middleware/auth.js` (existing, unchanged — `requireAuth` populates `req.session = { scopeType, scopeKey }` from the JWT, `requireMaster` 403s unless `scopeType === 'master'`).
- Produces: `masterBackupRouter` (Express `Router`, exported), mounted with no path prefix (route paths inside the router are absolute, matching `maintenanceRouter`'s existing style). Live endpoint: `GET /master/backup-export`.

- [ ] **Step 1: Write `src/routes/masterBackup.js`**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';

export const masterBackupRouter = Router();

// Hardcoded whitelist of real, in-use tables — excludes rate_limits
// (ephemeral) and the confirmed-unused leftover parallel schema. See
// docs/superpowers/specs/2026-08-11-master-subsystem-f-design.md.
const TABLES = [
  'staff_roster',
  'manager_pins',
  'manager_credentials',
  'content',
  'results',
  'wrong_answers',
  'reports',
  'ai_results',
  'ai_wrong_answers',
  'ai_quizzes',
  'standard_questions',
  'master_users',
  'audit_log',
  'system_settings',
];

// Generic JS-value -> SQL-literal mapper. No per-table special-casing:
// covers every column type present across the 14 whitelisted tables
// (bigserial ids arrive as JS strings from node-pg and fall through to the
// string branch, which is fine — Postgres casts a quoted numeric literal to
// bigint automatically on INSERT).
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function buildDump() {
  const lines = [`-- Lautan Academy DB export — generated ${new Date().toISOString()}`, ''];
  for (const table of TABLES) {
    const { rows } = await pool.query(`select * from ${table}`);
    lines.push(`-- ${table} (${rows.length} rows)`);
    if (rows.length === 0) {
      lines.push('-- (empty)', '');
      continue;
    }
    const columns = Object.keys(rows[0]);
    const quotedColumns = columns.map((c) => `"${c}"`).join(', ');
    for (const row of rows) {
      const values = columns.map((c) => sqlLiteral(row[c])).join(', ');
      lines.push(`INSERT INTO ${table} (${quotedColumns}) VALUES (${values});`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

masterBackupRouter.get('/master/backup-export', requireAuth, requireMaster, async (req, res) => {
  const sql = await buildDump();
  const filename = `lautan-academy-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(sql);
});
```

- [ ] **Step 2: Mount the router in `src/index.js`**

Add the import next to the other route imports (`src/index.js:12-14` currently ends with `auditLogRouter`):

```js
import { masterBackupRouter } from './routes/masterBackup.js';
```

Add the mount next to the other unprefixed/`/master/*` mounts (near `src/index.js:21` `app.use(maintenanceRouter);` and `src/index.js:30-31` `app.use('/master/purge', masterPurgeRouter); app.use('/master/audit-log', auditLogRouter);`):

```js
app.use(masterBackupRouter);
```

Not wrapped in `checkMaintenance` — matches every other `/master/*` route, Master must always be able to operate.

- [ ] **Step 3: Start the backend and verify with curl**

Run: `cd lautan-academy-backend && node src/index.js` (not `npm run dev` — `--watch` has a known Windows restart-loop issue noted in project memory; plain `node` matches what production runs).

In a second terminal, log in as the real master account to get a token, then hit the new route:

```bash
curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<real master username>","password":"<real master password>"}'
```

Copy the `token` from the response, then:

```bash
curl -s http://localhost:3000/master/backup-export -H "Authorization: Bearer <token>" -o /tmp/backup-test.sql
```

Expected: file downloads without error. Open it and confirm:
- Starts with the `-- Lautan Academy export — generated ...` header comment.
- Contains `INSERT INTO staff_roster (...)` lines with real column data.
- At least one table with a jsonb column (`ai_quizzes` if any AI quizzes exist, else `system_settings`'s `value` column) shows a `'...'::jsonb` cast, and the JSON inside parses correctly (spot check by eye).
- Find any row whose text contains an apostrophe (check `content.body` or `reports` free-text fields, or add one temporarily if none exist) and confirm the generated `INSERT` escapes it as `''` and is syntactically valid (single unbalanced quote would corrupt every line after it — visually scan that quote counts look even).

- [ ] **Step 4: Verify auth gating**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/master/backup-export
```

Expected: `401` (no token).

```bash
curl -s -X POST http://localhost:3000/auth/staff-login -H "Content-Type: application/json" -d '{"division":"retail","outlet":"<real outlet>","name":"<real staff name>","pin":"<real pin>"}'
```

Copy that staff token, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/master/backup-export -H "Authorization: Bearer <staff token>"
```

Expected: `403` (wrong scopeType).

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add src/routes/masterBackup.js src/index.js
git commit -m "feat: add master DB backup/export route"
```

---

## Task 2: Frontend — API client method

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\api\client.js`

**Interfaces:**
- Consumes: module-scoped `BASE_URL` const (`client.js:6`, already defined, not exported — this new function lives in the same module so it can reference it directly).
- Produces: `api.masterBackupExport(masterToken)` — async, resolves `{ blob: Blob, filename: string }`, throws `Error` with a `.message` on failure. Consumed by Task 3's `MasterBackupExport.vue`.

- [ ] **Step 1: Add the method to the `api` object**

The existing `request()` helper (`client.js:12-45`) always calls `res.json()`, which is wrong for this endpoint (response body is raw SQL text, not JSON) — so this needs its own `fetch()` call, not `request()`. Add as the last entry in the `api` object, right after `setMaintenanceStatus` (`client.js:126-131`):

```js
  masterBackupExport: async (masterToken) => {
    const res = await fetch(`${BASE_URL}/master/backup-export`, {
      headers: { Authorization: `Bearer ${masterToken}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Request failed (${res.status})`)
    }
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="?([^"]+)"?/)
    const filename = match ? match[1] : `lautan-academy-backup-${Date.now()}.sql`
    return { blob, filename }
  },
```

- [ ] **Step 2: Sanity-check in isolation**

No test framework exists — verify by reading the diff carefully: confirm `BASE_URL` is in scope (module-level const above, not inside `request()`), confirm no stray comma/bracket broke the `api` object literal. This gets exercised for real once Task 3 wires it into the UI.

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/api/client.js
git commit -m "feat: add masterBackupExport API client method"
```

---

## Task 3: Frontend — panel component + i18n + wiring

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterBackupExport.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterPanel.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\en.json`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\ms.json`

**Interfaces:**
- Consumes: `api.masterBackupExport(masterToken)` from Task 2; `useMasterAuthStore()` from `../store/masterAuth` (existing — exposes `.token`, same usage as `MasterMaintenance.vue:12,39`); `useI18n()` from `vue-i18n` (existing pattern, every Master panel component uses it identically).
- Produces: `MasterBackupExport.vue` component, emits `close` (matches every sibling panel — `MasterPinReset`, `MasterDataPurge`, `MasterMaintenance`, `MasterAuditLog` all emit the same event, consumed by `MasterPanel.vue`'s `@close="activeTab = null"`).

- [ ] **Step 1: Write `src/components/MasterBackupExport.vue`**

```vue
<script setup>
// Master-only: one-click full-DB export (Subsystem F). Mirrors
// MasterMaintenance.vue's back-button + status-message shape. See
// docs/superpowers/specs/2026-08-11-master-subsystem-f-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const exporting = ref(false)
const status = ref('')
const statusOk = ref(false)

async function exportBackup() {
  exporting.value = true
  status.value = ''
  try {
    const { blob, filename } = await api.masterBackupExport(masterAuth.token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    status.value = t('masterPanel.backupExport.success')
    statusOk.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.backupExport.errorFailed')
    statusOk.value = false
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="px-5 py-4 space-y-4">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.backupExport.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.backupExport.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.backupExport.intro') }}</p>
    </div>

    <button
      type="button"
      :disabled="exporting"
      @click="exportBackup"
      class="w-full bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ exporting ? t('masterPanel.backupExport.exporting') : t('masterPanel.backupExport.exportButton') }}
    </button>

    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys to `src/i18n/locales/en.json`**

The `masterPanel.tab.backupExport` label already exists (`en.json:516`, seeded when Subsystem A built the tab shell) — this adds the panel-body strings. Insert a new `"backupExport"` object immediately after the `"auditLogs"` block closes and before `"dataPurge"` starts (`en.json:571-572`):

```json
    "auditLogs": {
      ...
      "colCount": "Count"
    },
    "backupExport": {
      "title": "Backup & Export",
      "intro": "Download a full SQL export of the database — every staff, quiz, content, and account record. Restoring it requires the schema to already exist (see sql/schema.sql); this file only contains data.",
      "back": "Back",
      "exportButton": "Export Backup",
      "exporting": "Exporting...",
      "success": "Backup downloaded.",
      "errorFailed": "Could not export backup."
    },
    "dataPurge": {
```

(Only the new `"backupExport"` block is an actual change — `"auditLogs"` and `"dataPurge"` are shown for placement context, do not modify their contents.)

- [ ] **Step 3: Add the matching block to `src/i18n/locales/ms.json`**

Same insertion point (`ms.json:571`, right after `"auditLogs"` closes, before `"dataPurge"` at `ms.json:572`):

```json
    "backupExport": {
      "title": "Sandaran & Eksport",
      "intro": "Muat turun eksport SQL penuh pangkalan data — setiap rekod staf, kuiz, kandungan, dan akaun. Untuk memulihkannya, skema mesti sudah wujud (lihat sql/schema.sql); fail ini hanya mengandungi data.",
      "back": "Kembali",
      "exportButton": "Eksport Sandaran",
      "exporting": "Mengeksport...",
      "success": "Sandaran telah dimuat turun.",
      "errorFailed": "Gagal mengeksport sandaran."
    },
```

- [ ] **Step 4: Wire into `MasterPanel.vue`**

Add the import next to the other panel imports (`MasterPanel.vue:5-8`):

```js
import MasterBackupExport from './MasterBackupExport.vue'
```

Move `'backupExport'` from `TABS`-only into `ENABLED_TABS` (`MasterPanel.vue:17-18`):

```js
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']
const ENABLED_TABS = ['pinReset', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport']
```

Add the render branch next to the other panel components (`MasterPanel.vue:37-40`):

```html
<MasterBackupExport v-else-if="activeTab === 'backupExport'" @close="activeTab = null" />
```

Placed after the existing `MasterAuditLog` line. Drawer width stays `max-w-sm` (not added to the `['dataPurge', 'auditLogs']` wide-drawer list at `MasterPanel.vue:31`) — this panel is a single button, no table, matches `pinReset`/`maintenanceMode`'s narrow width.

- [ ] **Step 5: Build check**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build, no errors, no warnings about the new files.

- [ ] **Step 6: EN/MS key-parity check**

Run (from `lautan-academy-frontend`):

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
const missingInMs = [...enKeys].filter((k) => !msKeys.has(k));
const missingInEn = [...msKeys].filter((k) => !enKeys.has(k));
console.log('Missing in ms:', missingInMs);
console.log('Missing in en:', missingInEn);
"
```

Expected: both arrays empty.

- [ ] **Step 7: Live browser click-through**

Start both dev servers (`cd lautan-academy-backend && node src/index.js`, `cd lautan-academy-frontend && npm run dev`). In the browser: log in as Master, open the panel, click "Backup & Export" (no longer "Coming Soon"), click "Export Backup", confirm a `.sql` file downloads and its contents look sane (open it in a text editor). Toggle to Bahasa Malaysia and repeat — confirm all new strings render in BM, button and status messages included.

- [ ] **Step 8: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterBackupExport.vue lautan-academy-frontend/src/components/MasterPanel.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "feat: wire MasterBackupExport into Master Panel's backupExport tab"
```

---

## Post-implementation: update MEMORY.md / SCOPE_TRACKER.md

Per `CLAUDE.md` rule 5: once all 3 tasks are verified (curl round-trips, build clean, EN/MS parity clean, live browser click-through both languages), add a Subsystem F entry to `MEMORY.md`'s Master Subsystem list (same format as A–E: what was built, backend/frontend commit hashes, spec/plan links, what was verified and how), and flag the `master_users`/`sql/schema.sql` gap there if not already tracked elsewhere. Then prompt the user to `/clear`.
