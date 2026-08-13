# Annual Data Reset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Master a way to archive-then-clear quiz-attempt history + audit log older than the current calendar year, from the existing Backup & Export panel, gated so the Reset button only unlocks after a backup export succeeds in the same visit.

**Architecture:** One new backend file (`routes/masterAnnualReset.js`, mounted at `/master/annual-reset`) with a read-only preview endpoint and a transactional delete endpoint covering 6 hardcoded tables. `MasterBackupExport.vue` gets a new section below its existing export button — a local `backedUp` flag (set on successful export, reset on every fresh mount) gates a Reset button that opens the existing `MasterDeleteConfirmModal.vue`.

**Tech Stack:** Node.js/Express/`pg` (backend), Vue 3 `<script setup>`/Pinia/`vue-i18n` (frontend). No new dependencies.

## Global Constraints

- Backend: `requireAuth, requireMaster` on both new routes — same gate as every other Master-only route.
- Cutoff is always `date_trunc('year', now())` — everything before Jan 1 of the current year. Never a rolling window.
- Exactly 6 tables in scope: `results`, `wrong_answers`, `ai_results`, `ai_wrong_answers`, `reports`, `audit_log`. No other table is touched by this feature.
- The reset's own `audit_log` row is written inside the same transaction as the deletes, dated `now()` — it must survive the cutoff it describes. Order matters: write the log row, then it's safe regardless of whether it happens before or after the deletes within the transaction (its `created_at` is always "now", never in the deleted range) — but write it last in code so the final `affected_count` reflects the real totals, not a guess.
- No FK constraints exist between any of the 6 tables (confirmed against `sql/schema.sql`) — delete order across them doesn't matter for integrity.
- No test framework exists in either repo (confirmed: backend `package.json` has no test runner; frontend has no vitest/jest). Verification is `npm run build` (frontend) + curl against a running dev server (backend) + manual browser click-through — matching every prior subsystem's convention, not a plan gap.
- Bilingual EN/MS for every user-facing string, under `masterPanel.backupExport.annualReset.*` in `src/i18n/locales/{en,ms}.json` (sibling of the existing `masterPanel.backupExport.*` keys).
- Backend repo: `C:\Users\Hafiz\projects\lautan-academy-backend`. Frontend repo: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend`. Separate git repos — commit each independently.
- `withTransaction` is a small file-local helper duplicated per route file in this codebase (see `masterSessions.js`'s own copy and its comment) — not imported from `masterPurge.js`.

---

## Task 1: `routes/masterAnnualReset.js` — preview + reset endpoints

**Files:**
- Create: `lautan-academy-backend/src/routes/masterAnnualReset.js`
- Modify: `lautan-academy-backend/src/index.js` (mount router)

**Interfaces:**
- Consumes: `pool` from `../config/db.js`; `requireAuth, requireMaster` from `../middleware/auth.js`; `logAudit` from `../services/auditLog.js`.
- Produces: `GET /master/annual-reset/preview` → `{ cutoff: <ISO string>, counts: { results, wrongAnswers, aiResults, aiWrongAnswers, reports, auditLog } }`. `POST /master/annual-reset` → `{ status: 'ok', counts: {...same shape...}, deletedTotal }` or `{ status: 'error', error }`. Consumed by Task 2's `api.masterAnnualResetPreview`/`api.masterAnnualReset`.

- [ ] **Step 1: Create the router file**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';
import { logAudit } from '../services/auditLog.js';

export const masterAnnualResetRouter = Router();

// Same pattern as masterSessions.js's own copy — file-local, not shared,
// matching this codebase's existing convention of small per-file helpers
// over a shared utility module. See
// docs/superpowers/specs/2026-08-14-annual-data-reset-design.md.
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

// Always Jan 1 of the current calendar year — never a rolling window. Lines
// up with CPD Hours' own existing Jan-1 reset (cpdHoursThisYear() in
// data.js already only ever looks at the current year).
const CUTOFF_SQL = "date_trunc('year', now())";

async function countBeforeCutoff(db) {
  const [results, wrongAnswers, aiResults, aiWrongAnswers, reports, auditLog] = await Promise.all([
    db.query(`select count(*) from results where created_at < ${CUTOFF_SQL}`),
    db.query(`select count(*) from wrong_answers where created_at < ${CUTOFF_SQL}`),
    db.query(`select count(*) from ai_results where created_at < ${CUTOFF_SQL}`),
    db.query(`select count(*) from ai_wrong_answers where created_at < ${CUTOFF_SQL}`),
    db.query(`select count(*) from reports where created_at < ${CUTOFF_SQL}`),
    db.query(`select count(*) from audit_log where created_at < ${CUTOFF_SQL}`),
  ]);
  return {
    results: Number(results.rows[0].count),
    wrongAnswers: Number(wrongAnswers.rows[0].count),
    aiResults: Number(aiResults.rows[0].count),
    aiWrongAnswers: Number(aiWrongAnswers.rows[0].count),
    reports: Number(reports.rows[0].count),
    auditLog: Number(auditLog.rows[0].count),
  };
}

masterAnnualResetRouter.get('/preview', requireAuth, requireMaster, async (req, res) => {
  const { rows } = await pool.query(`select ${CUTOFF_SQL} as cutoff`);
  const counts = await countBeforeCutoff(pool);
  res.json({ cutoff: rows[0].cutoff, counts });
});

masterAnnualResetRouter.post('/', requireAuth, requireMaster, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const beforeCounts = await countBeforeCutoff(client);

      const [rResults, rWrong, rAi, rAiWrong, rReports, rAudit] = await Promise.all([
        client.query(`delete from results where created_at < ${CUTOFF_SQL}`),
        client.query(`delete from wrong_answers where created_at < ${CUTOFF_SQL}`),
        client.query(`delete from ai_results where created_at < ${CUTOFF_SQL}`),
        client.query(`delete from ai_wrong_answers where created_at < ${CUTOFF_SQL}`),
        client.query(`delete from reports where created_at < ${CUTOFF_SQL}`),
        client.query(`delete from audit_log where created_at < ${CUTOFF_SQL}`),
      ]);

      const counts = {
        results: rResults.rowCount,
        wrongAnswers: rWrong.rowCount,
        aiResults: rAi.rowCount,
        aiWrongAnswers: rAiWrong.rowCount,
        reports: rReports.rowCount,
        auditLog: rAudit.rowCount,
      };
      const deletedTotal = Object.values(counts).reduce((a, b) => a + b, 0);

      // Dated now() by the table's own default — always this calendar
      // year, so this row survives the very cutoff it describes.
      await logAudit(client, {
        actorType: 'master',
        actorKey: req.session.scopeKey,
        action: 'master.annual_reset',
        summary: `Annual reset: ${JSON.stringify(counts)} (expected pre-cutoff: ${JSON.stringify(beforeCounts)})`,
        affectedCount: deletedTotal,
      });

      return { counts, deletedTotal };
    });

    res.json({ status: 'ok', counts: result.counts, deletedTotal: result.deletedTotal });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message || 'Reset failed.' });
  }
});
```

- [ ] **Step 2: Mount the router in `src/index.js`**

Add the import near the other `master*Router` imports:
```js
import { masterAnnualResetRouter } from './routes/masterAnnualReset.js';
```
Add the mount line near the other `/master/...` mounts:
```js
app.use('/master/annual-reset', masterAnnualResetRouter);
```

- [ ] **Step 3: Start the dev server**

Run (from `lautan-academy-backend/`): `npm run dev` (leave running in background for the curl steps below).

- [ ] **Step 4: Get a master token**

```bash
curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<your master username>","password":"<your master password>"}'
```
Expected: `{"authorized":true,"token":"..."}`. Save the token as `$TOKEN` for the following steps.

- [ ] **Step 5: Seed one pre-cutoff row and one current-year row in each of the 6 tables**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => {
  const past = \"'2020-01-01T00:00:00Z'\";
  await pool.query(\`insert into results (attempt_id, outlet, name, topic, score, percentage, created_at) values ('resettest-old','ZZTEST','RESETTEST','Topic','1/1','100%',\${past})\`);
  await pool.query(\"insert into results (attempt_id, outlet, name, topic, score, percentage) values ('resettest-new','ZZTEST','RESETTEST','Topic','1/1','100%')\");
  await pool.query(\`insert into wrong_answers (attempt_id, outlet, staff_name, topic, question, chosen, correct, created_at) values ('resettest-old','ZZTEST','RESETTEST','Topic','Q?','A','B',\${past})\`);
  await pool.query(\"insert into wrong_answers (attempt_id, outlet, staff_name, topic, question, chosen, correct) values ('resettest-new','ZZTEST','RESETTEST','Topic','Q?','A','B')\");
  await pool.query(\`insert into ai_results (attempt_id, outlet, name, topic, score, percentage, passcode, created_at) values ('resettest-old-ai','ZZTEST','RESETTEST','Topic','1/1','100%','999',\${past})\`);
  await pool.query(\"insert into ai_results (attempt_id, outlet, name, topic, score, percentage, passcode) values ('resettest-new-ai','ZZTEST','RESETTEST','Topic','1/1','100%','999')\");
  await pool.query(\`insert into ai_wrong_answers (attempt_id, outlet, staff_name, topic, question, chosen, correct, created_at) values ('resettest-old-ai','ZZTEST','RESETTEST','Topic','Q?','A','B',\${past})\`);
  await pool.query(\"insert into ai_wrong_answers (attempt_id, outlet, staff_name, topic, question, chosen, correct) values ('resettest-new-ai','ZZTEST','RESETTEST','Topic','Q?','A','B')\");
  await pool.query(\`insert into reports (outlet, staff_name, manager, topic, created_at) values ('ZZTEST','RESETTEST','Test Mgr','ResetTestTopicOld',\${past})\`);
  await pool.query(\"insert into reports (outlet, staff_name, manager, topic) values ('ZZTEST','RESETTEST','Test Mgr','ResetTestTopicNew')\");
  await pool.query(\`insert into audit_log (actor_type, actor_key, action, summary, created_at) values ('master','test','test.old','old row',\${past})\`);
  await pool.query(\"insert into audit_log (actor_type, actor_key, action, summary) values ('master','test','test.new','new row')\");
  await pool.end();
})"
```

- [ ] **Step 6: Preview reports only the pre-cutoff rows**

```bash
curl -s http://localhost:3000/master/annual-reset/preview -H "Authorization: Bearer $TOKEN"
```
Expected: `counts` shows `results: 1, wrongAnswers: 1, aiResults: 1, aiWrongAnswers: 1, reports: 1, auditLog` at least `1` (could be higher if real audit rows predate this year — that's correct, not a bug). `cutoff` is Jan 1 of the current year.

- [ ] **Step 7: Reset deletes exactly the pre-cutoff rows**

```bash
curl -s -X POST http://localhost:3000/master/annual-reset -H "Authorization: Bearer $TOKEN"
```
Expected: `{"status":"ok","counts":{"results":1,"wrongAnswers":1,"aiResults":1,"aiWrongAnswers":1,"reports":1,"auditLog":N},"deletedTotal":...}` where `auditLog` count includes the old test row (and any other real pre-cutoff audit rows).

- [ ] **Step 8: Verify current-year rows survive and pre-cutoff rows are gone**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => {
  const r1 = await pool.query(\"select attempt_id from results where outlet='ZZTEST'\");
  console.log('results remaining:', r1.rows);
  const r2 = await pool.query(\"select topic from reports where outlet='ZZTEST'\");
  console.log('reports remaining:', r2.rows);
  await pool.end();
})"
```
Expected: `results remaining` shows only `resettest-new` (the pre-cutoff `resettest-old` row is gone). `reports remaining` shows only `ResetTestTopicNew`.

- [ ] **Step 9: Verify the reset's own audit_log row survived the cutoff it just enforced**

```bash
curl -s http://localhost:3000/master/annual-reset/preview -H "Authorization: Bearer $TOKEN"
```
Expected: `counts.auditLog` is now `0` (the pre-cutoff test row and any other old rows were just deleted) — proving the `master.annual_reset` row written during Step 7 (dated `now()`, this year) is NOT counted as pre-cutoff, i.e. it wasn't deleted by its own transaction.

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => { const r = await pool.query(\"select action, summary from audit_log where action='master.annual_reset' order by id desc limit 1\"); console.log(r.rows); await pool.end(); })"
```
Expected: one row, `action: 'master.annual_reset'`, `summary` mentioning the counts from Step 7.

- [ ] **Step 10: Verify non-master token is rejected**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/master/annual-reset/preview -H "Authorization: Bearer <a regular staff or manager token>"
```
Expected: `403`.

- [ ] **Step 11: Verify a second reset run is a safe no-op**

```bash
curl -s -X POST http://localhost:3000/master/annual-reset -H "Authorization: Bearer $TOKEN"
```
Expected: `{"status":"ok","counts":{"results":0,"wrongAnswers":0,"aiResults":0,"aiWrongAnswers":0,"reports":0,"auditLog":0},"deletedTotal":0}` — no error on zero eligible rows.

- [ ] **Step 12: Clean up remaining seed data**

```bash
node -e "import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from results where outlet='ZZTEST'\");
  await pool.query(\"delete from wrong_answers where outlet='ZZTEST'\");
  await pool.query(\"delete from ai_results where outlet='ZZTEST'\");
  await pool.query(\"delete from ai_wrong_answers where outlet='ZZTEST'\");
  await pool.query(\"delete from reports where outlet='ZZTEST'\");
  await pool.end();
})"
```

- [ ] **Step 13: Commit**

```bash
git add src/routes/masterAnnualReset.js src/index.js
git commit -m "feat: add Master annual data reset preview+execute endpoints"
```

---

## Task 2: Frontend `api/client.js` — annual reset functions

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js`

**Interfaces:**
- Consumes: `request(path, options)` helper already in this file; both endpoints from Task 1.
- Produces: `api.masterAnnualResetPreview(masterToken)`, `api.masterAnnualReset(masterToken)` — consumed by Task 3's `MasterBackupExport.vue`.

- [ ] **Step 1: Add the 2 functions to the `api` object**, right after `masterBackupExport` (or wherever the other `master*` functions are grouped — match existing ordering):

```js
  masterAnnualResetPreview: (masterToken) =>
    request('/master/annual-reset/preview', { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterAnnualReset: (masterToken) =>
    request('/master/annual-reset', { method: 'POST', headers: { Authorization: `Bearer ${masterToken}` } }),
```

- [ ] **Step 2: Build check**

Run (from `lautan-academy-frontend/`): `npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/client.js
git commit -m "feat: add api client functions for Master annual reset endpoints"
```

---

## Task 3: `MasterBackupExport.vue` — Annual Reset section

**Files:**
- Modify: `lautan-academy-frontend/src/components/MasterBackupExport.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.masterAnnualResetPreview`, `api.masterAnnualReset` (Task 2); `MasterDeleteConfirmModal` (existing component, props `title: String`, `breakdown: Array<{label:String,count:Number}>`, `loading: Boolean`, emits `confirm`/`cancel` — already used by every `Purge*Panel.vue`).

- [ ] **Step 1: Replace the full `<script setup>` block**

```vue
<script setup>
// Master-only: one-click full-DB export (Subsystem F), plus Annual Data
// Reset — archive-then-clear quiz-attempt history + audit log older than
// the current calendar year. Reset is hard-gated behind a successful
// export in the same visit (backedUp flag, resets on every fresh mount —
// never persisted). See
// docs/superpowers/specs/2026-08-11-master-subsystem-f-design.md and
// docs/superpowers/specs/2026-08-14-annual-data-reset-design.md.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const exporting = ref(false)
const status = ref('')
const statusOk = ref(false)
const backedUp = ref(false)

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
    backedUp.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.backupExport.errorFailed')
    statusOk.value = false
  } finally {
    exporting.value = false
  }
}

const previewCounts = ref(null)
const previewCutoff = ref(null)
const previewError = ref('')
const showResetConfirm = ref(false)
const resetting = ref(false)
const resetStatus = ref('')
const resetStatusOk = ref(false)

async function loadPreview() {
  previewError.value = ''
  try {
    const data = await api.masterAnnualResetPreview(masterAuth.token)
    previewCounts.value = data.counts
    previewCutoff.value = data.cutoff
  } catch (err) {
    previewError.value = err.message || t('masterPanel.backupExport.annualReset.errorPreviewFailed')
  }
}
onMounted(loadPreview)

function resetBreakdown() {
  if (!previewCounts.value) return []
  const c = previewCounts.value
  return [
    { label: t('masterPanel.backupExport.annualReset.breakdownResults'), count: c.results },
    { label: t('masterPanel.backupExport.annualReset.breakdownWrongAnswers'), count: c.wrongAnswers },
    { label: t('masterPanel.backupExport.annualReset.breakdownAiResults'), count: c.aiResults },
    { label: t('masterPanel.backupExport.annualReset.breakdownAiWrongAnswers'), count: c.aiWrongAnswers },
    { label: t('masterPanel.backupExport.annualReset.breakdownReports'), count: c.reports },
    { label: t('masterPanel.backupExport.annualReset.breakdownAuditLog'), count: c.auditLog },
  ]
}

async function confirmReset() {
  resetting.value = true
  resetStatus.value = ''
  try {
    const data = await api.masterAnnualReset(masterAuth.token)
    resetStatus.value = t('masterPanel.backupExport.annualReset.successReset', { count: data.deletedTotal })
    resetStatusOk.value = true
    showResetConfirm.value = false
    await loadPreview()
  } catch (err) {
    resetStatus.value = err.message || t('masterPanel.backupExport.annualReset.errorResetFailed')
    resetStatusOk.value = false
  } finally {
    resetting.value = false
  }
}
</script>
```

- [ ] **Step 2: Replace the `<template>` block**

```vue
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

    <div class="border-t border-seafoam pt-4 space-y-3">
      <div>
        <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.backupExport.annualReset.title') }}</h3>
        <p class="text-slate text-xs">{{ t('masterPanel.backupExport.annualReset.intro') }}</p>
      </div>

      <p v-if="previewError" class="text-coral text-xs">{{ previewError }}</p>
      <div v-else-if="previewCounts" class="border border-seafoam rounded-lg p-3 text-xs text-slate space-y-1">
        <p class="text-ink font-medium">{{ t('masterPanel.backupExport.annualReset.cutoffLabel', { date: new Date(previewCutoff).toLocaleDateString() }) }}</p>
        <div v-for="row in resetBreakdown()" :key="row.label" class="flex justify-between">
          <span>{{ row.label }}</span>
          <span class="font-medium text-ink">{{ row.count }}</span>
        </div>
      </div>

      <p v-if="!backedUp" class="text-xs text-slate">{{ t('masterPanel.backupExport.annualReset.gateHint') }}</p>
      <button
        type="button"
        :disabled="!backedUp"
        @click="showResetConfirm = true"
        class="w-full bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40"
      >
        {{ t('masterPanel.backupExport.annualReset.resetButton') }}
      </button>

      <p v-if="resetStatus" class="text-xs" :class="resetStatusOk ? 'text-aqua' : 'text-coral'">{{ resetStatus }}</p>
    </div>

    <MasterDeleteConfirmModal
      v-if="showResetConfirm"
      :title="t('masterPanel.backupExport.annualReset.confirmTitle')"
      :breakdown="resetBreakdown()"
      :loading="resetting"
      @confirm="confirmReset"
      @cancel="showResetConfirm = false"
    />
  </div>
</template>
```

- [ ] **Step 3: Add i18n keys** — in `src/i18n/locales/en.json`, inside the existing `"masterPanel"."backupExport"` object (sibling of `"title"`/`"intro"`/`"exportButton"` etc.), add a new `"annualReset"` key:

```json
      "annualReset": {
        "title": "Annual Data Reset",
        "intro": "Permanently clears quiz results, wrong answers, assessment reports, and audit log entries dated before this calendar year. Staff accounts, manager accounts, and outlet/area config are never touched. Export a backup above first \u2014 the button below stays locked until you do.",
        "cutoffLabel": "Everything before {date}",
        "gateHint": "Export a backup first to unlock this.",
        "resetButton": "Reset Old Data",
        "confirmTitle": "Delete all quiz history and audit log entries before this year?",
        "breakdownResults": "Module Quiz results",
        "breakdownWrongAnswers": "Module Quiz wrong answers",
        "breakdownAiResults": "AI Practice results",
        "breakdownAiWrongAnswers": "AI Practice wrong answers",
        "breakdownReports": "Assessment reports",
        "breakdownAuditLog": "Audit log entries",
        "successReset": "Reset complete \u2014 {count} row(s) deleted.",
        "errorPreviewFailed": "Could not load the preview counts.",
        "errorResetFailed": "Reset failed."
      }
```

In `src/i18n/locales/ms.json`, same location:

```json
      "annualReset": {
        "title": "Reset Data Tahunan",
        "intro": "Memadam kekal keputusan kuiz, jawapan salah, laporan penilaian, dan log audit sebelum tahun kalendar semasa. Akaun staf, akaun pengurus, dan konfigurasi outlet/kawasan tidak disentuh. Eksport sandaran di atas dahulu \u2014 butang di bawah kekal berkunci sehingga anda berbuat demikian.",
        "cutoffLabel": "Semua sebelum {date}",
        "gateHint": "Eksport sandaran dahulu untuk membuka ini.",
        "resetButton": "Reset Data Lama",
        "confirmTitle": "Padam semua sejarah kuiz dan log audit sebelum tahun ini?",
        "breakdownResults": "Keputusan Module Quiz",
        "breakdownWrongAnswers": "Jawapan salah Module Quiz",
        "breakdownAiResults": "Keputusan AI Practice",
        "breakdownAiWrongAnswers": "Jawapan salah AI Practice",
        "breakdownReports": "Laporan penilaian",
        "breakdownAuditLog": "Entri log audit",
        "successReset": "Reset selesai \u2014 {count} baris dipadam.",
        "errorPreviewFailed": "Tidak dapat memuatkan jumlah pratonton.",
        "errorResetFailed": "Reset gagal."
      }
```

- [ ] **Step 4: Build check**

Run (from `lautan-academy-frontend/`): `npm run build`
Expected: clean build, no errors.

- [ ] **Step 5: Live browser click-through**

Start both dev servers (`npm run dev` in each repo), log in as Master, open Backup & Export:
- Confirm the Reset button is disabled and the gate hint is visible before clicking Export.
- Confirm the preview breakdown renders with real counts and the correct cutoff date.
- Click Export Backup, confirm the file downloads and the Reset button becomes enabled immediately after.
- Click Reset, confirm the type-`DELETE`-to-confirm modal opens with the same breakdown counts.
- Confirm, verify the success message shows a count and the breakdown re-fetches (should now show lower/zero counts for any rows that were actually pre-cutoff).
- Close the panel and reopen Backup & Export fresh — confirm the Reset button is disabled again (gate reset on remount, export not remembered across visits).
- Switch language to BM, confirm all new strings render correctly.

- [ ] **Step 6: Commit**

```bash
git add src/components/MasterBackupExport.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add Annual Data Reset section to Master Backup & Export"
```

---

## Task 4: Update `MEMORY.md`

**Files:**
- Modify: `lautan-academy/MEMORY.md`

- [ ] **Step 1: Add a `[DONE]` entry**

Following the existing style (see any `[DONE, ...]` entry for format), record: what was built (preview+reset endpoints, hard backup-gate, 6-table scope, Jan-1-of-current-year cutoff), that CPD Hours is unaffected (confirmed non-dependency from the spec), and the verification performed (curl round-trip with seeded old/new rows across all 6 tables, `npm run build` clean, live browser click-through covering the gate behavior).

- [ ] **Step 2: Commit**

```bash
cd C:\Users\Hafiz\projects\lautan-academy
git add MEMORY.md
git commit -m "docs: record Annual Data Reset feature in MEMORY.md"
```
