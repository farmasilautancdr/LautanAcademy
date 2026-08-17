# Mandatory-Course Compliance Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every manager tier a pass/fail matrix of tagged Pharmacist staff against mandatory Pharmacist Courses, let a pharmacist download their own full training record before Annual Data Reset can purge it, and lower the global CPD target from 120hr/year to 60hr/year.

**Architecture:** Backend: one new read-only endpoint (`GET /pharmacist-compliance`), scoped identically to the existing `/data/scoped-data`, computed entirely on read from existing tables — no schema changes. Frontend: one new self-fetching component (`PharmacistComplianceMatrix.vue`) dropped into the four existing per-tier results/comparison views, a CSV-export button added to the staff's own Quiz History page, and a duplicated `CPD_TARGET_HOURS` constant (currently `120` in 5 separate files) centralized into `useCpdHours.js` at the new value `60`.

**Tech Stack:** Vue 3 + Vite + Tailwind (frontend), Node.js + Express + Postgres/Supabase (backend). No new dependencies.

## Global Constraints

- No new database tables or columns — everything in this feature is computed on read, same pattern as CPD Hours Tracking.
- Compliance = best-ever attempt `percentage >= 70` per (staff, course) pair, not most-recent-attempt.
- A (staff, course) pair with zero `results` rows is `{ attempted: false }` — never rendered as a failed/0% attempt.
- `GET /pharmacist-compliance` is manager-only (`outlet_manager`, `warehouse_manager`, `area_manager`, `supervisor`); any other `scopeType` gets 403.
- The compliance matrix ships live immediately for managers — it is NOT behind the `auth.impersonating` gate (that gate only covers staff-facing nav/pages).
- The self-export CSV button IS behind `auth.impersonating` (same boundary as the CPD data it's built from) AND `auth.staff?.isPharmacist`.
- EN/MS strings required for every new user-facing string, per existing bilingual convention (`src/i18n/locales/en.json` / `ms.json`).
- No automated test suite exists in either repo — verification is `curl` round-trips (backend), `npm run build` + EN/MS key-parity check (frontend), and live browser click-through, matching every prior feature in this codebase.
- Spec: `docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md`.

---

### Task 1: Backend — `GET /pharmacist-compliance` endpoint

**Files:**
- Modify: `lautan-academy-backend/src/routes/data.js:4` (export `outletsForArea`)
- Create: `lautan-academy-backend/src/routes/pharmacistCompliance.js`
- Modify: `lautan-academy-backend/src/index.js` (mount the router)

**Interfaces:**
- Consumes: `outletsForArea(areaId)` (exported from `data.js`), `requireAuth` (`middleware/auth.js`, existing), `pool` (`config/db.js`, existing).
- Produces: `GET /pharmacist-compliance` → `{ staff: [{outlet, name}], courses: [{id, title, topic, hours}], cells: { "OUTLET|NAME": { "<topic>": {attempted, percentage?, passed?, date?} } } }`. Frontend Task 2 calls this by exact path/shape.

- [ ] **Step 1: Export `outletsForArea` from `data.js`**

In `lautan-academy-backend/src/routes/data.js`, change line 4:

```js
async function outletsForArea(areaId) {
```

to:

```js
export async function outletsForArea(areaId) {
```

- [ ] **Step 2: Write the new router**

Create `lautan-academy-backend/src/routes/pharmacistCompliance.js`:

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { outletsForArea } from './data.js';

export const pharmacistComplianceRouter = Router();

// Mandatory-course compliance matrix (CPD sub-project C) — manager-only,
// scoped identically to /data/scoped-data. Fully computed on read from
// staff_roster/video_trainings/results, same pattern as CPD Hours — no new
// tables. Compliance = best-ever attempt >= 70%, not most-recent. See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
pharmacistComplianceRouter.get('/', requireAuth, async (req, res) => {
  const { scopeType, scopeKey } = req.session;

  let outletFilter = null; // null = no filter (supervisor, company-wide)
  if (scopeType === 'outlet_manager' || scopeType === 'warehouse_manager') {
    outletFilter = [scopeKey];
  } else if (scopeType === 'area_manager') {
    outletFilter = await outletsForArea(scopeKey);
  } else if (scopeType !== 'supervisor') {
    return res.status(403).json({ status: 'error', error: 'Not authorized.' });
  }

  const staffParams = [];
  let staffWhere = 'is_pharmacist = true';
  if (outletFilter) {
    staffParams.push(outletFilter);
    staffWhere += ' and outlet = ANY($1)';
  }
  const { rows: staffRows } = await pool.query(
    `select outlet, name from staff_roster where ${staffWhere} order by outlet, name`,
    staffParams
  );

  const { rows: courseRows } = await pool.query(
    `select id, title, topic, hours from video_trainings where pharmacist_only = true order by created_at`
  );
  const topics = courseRows.map(c => c.topic);

  let resultRows = [];
  if (topics.length && staffRows.length) {
    const resultParams = [topics];
    let resultWhere = 'topic = ANY($1)';
    if (outletFilter) {
      resultParams.push(outletFilter);
      resultWhere += ' and outlet = ANY($2)';
    }
    const { rows } = await pool.query(
      `select outlet, name, topic, percentage, created_at from results where ${resultWhere}`,
      resultParams
    );
    resultRows = rows;
  }

  // Best-ever attempt per (outlet|name, topic). percentage is stored as
  // text like "83%" throughout this table (see POST /data/results) —
  // parsed here, not in SQL, matching how every other percentage
  // comparison in this codebase already does it.
  const best = new Map();
  for (const r of resultRows) {
    const key = `${r.outlet}|${r.name}|${r.topic}`;
    const pct = parseInt(r.percentage) || 0;
    const existing = best.get(key);
    if (!existing || pct > existing.percentage) {
      best.set(key, { percentage: pct, date: r.created_at });
    }
  }

  const cells = {};
  for (const s of staffRows) {
    const staffKey = `${s.outlet}|${s.name}`;
    cells[staffKey] = {};
    for (const c of courseRows) {
      const entry = best.get(`${staffKey}|${c.topic}`);
      cells[staffKey][c.topic] = entry
        ? { attempted: true, percentage: entry.percentage, passed: entry.percentage >= 70, date: entry.date }
        : { attempted: false };
    }
  }

  res.json({
    staff: staffRows.map(s => ({ outlet: s.outlet, name: s.name })),
    courses: courseRows.map(c => ({ id: c.id, title: c.title, topic: c.topic, hours: Number(c.hours) })),
    cells,
  });
});
```

- [ ] **Step 3: Mount the router**

In `lautan-academy-backend/src/index.js`, add the import after the existing `masterImpersonateRouter` import (line 21):

```js
import { pharmacistComplianceRouter } from './routes/pharmacistCompliance.js';
```

Add the mount line after `app.use('/master/outlets', masterOutletsRouter);` (line 47):

```js
app.use('/pharmacist-compliance', checkMaintenance, pharmacistComplianceRouter);
```

- [ ] **Step 4: Start the backend**

Run: `cd lautan-academy-backend && npm run dev` (leave running)

- [ ] **Step 5: curl-verify a staff-role token is rejected**

`curl -s http://localhost:3000/pharmacist-compliance -H "Authorization: Bearer <any staff token>"`
Expected: 403, `{"status":"error","error":"Not authorized."}`.

- [ ] **Step 6: curl-verify Supervisor sees company-wide data**

`curl -s http://localhost:3000/pharmacist-compliance -H "Authorization: Bearer <supervisor token>"`
Expected: 200, `{"staff":[...],"courses":[...],"cells":{...}}`. If sub-project B's tagged staff member and pharmacist-only course still exist from prior testing, confirm that staff/course pair appears; otherwise confirm the arrays are simply empty (not an error).

- [ ] **Step 7: curl-verify Outlet Manager sees only their own outlet's pharmacist staff**

Tag a staff member Pharmacist in an outlet the test Outlet Manager does NOT manage (via `PATCH /staff-roster-manage/:id/pharmacist`, Supervisor token), then:
`curl -s http://localhost:3000/pharmacist-compliance -H "Authorization: Bearer <outlet manager token>"`
Expected: 200, that staff member is NOT in the `staff` array. Untag them afterward (leave test data clean).

- [ ] **Step 8: curl-verify best-ever, not most-recent**

Using a tagged pharmacist test staff member and one existing pharmacist-only course topic: submit one attempt scoring below 70% (`POST /data/video-results` or `POST /data/results` with a topic matching a `pharmacist_only` course — reuse Task 3/9's test course from the pharmacist-tag plan if still present, or add a throwaway one via `POST /video-trainings`), then a second attempt scoring 70%+. Re-run Step 6/7's GET as the relevant manager — expect that cell's `percentage` to reflect the higher score and `passed: true`, even after submitting a third, lower-scoring attempt afterward. Clean up any throwaway course/results rows created for this check.

- [ ] **Step 9: curl-verify a never-attempted pair**

Confirm any (staff, course) pair with no matching `results` row returns exactly `{"attempted":false}` — no `percentage`/`passed`/`date` keys present.

- [ ] **Step 10: Commit**

```bash
cd lautan-academy-backend
git add src/routes/data.js src/routes/pharmacistCompliance.js src/index.js
git commit -m "feat: add GET /pharmacist-compliance endpoint"
```

---

### Task 2: Frontend API client method

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js`

**Interfaces:**
- Consumes: `GET /pharmacist-compliance` (Task 1).
- Produces: `api.getPharmacistCompliance()`. Task 3 calls this by exact name.

- [ ] **Step 1: Add the method**

In `lautan-academy-frontend/src/api/client.js`, add after the existing `getScopedData` entry (line 79):

```js
  getPharmacistCompliance: () => request('/pharmacist-compliance'),
```

- [ ] **Step 2: `npm run build`**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
cd lautan-academy-frontend
git add src/api/client.js
git commit -m "feat: add getPharmacistCompliance API method"
```

---

### Task 3: `PharmacistComplianceMatrix.vue` component

**Files:**
- Create: `lautan-academy-frontend/src/components/PharmacistComplianceMatrix.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.getPharmacistCompliance()` (Task 2).
- Produces: `<PharmacistComplianceMatrix />` — no props, self-fetching, renders nothing when there's no pharmacist staff or no mandatory courses in scope. Task 4 drops this into 4 views.

- [ ] **Step 1: Write the component**

```vue
<script setup>
// Mandatory-course compliance matrix (CPD sub-project C). Self-fetching,
// same pattern as SupervisorPharmacistTagView.vue — no props. Renders
// nothing when staff/courses come back empty, matching the product
// principle of not showing UI for data that doesn't exist. See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const { t } = useI18n()
const staff = ref([])
const courses = ref([])
const cells = ref({})
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.getPharmacistCompliance()
    staff.value = data.staff || []
    courses.value = data.courses || []
    cells.value = data.cells || {}
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false
})

function cell(s, courseTopic) {
  return cells.value[`${s.outlet}|${s.name}`]?.[courseTopic] || { attempted: false }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString()
}
</script>

<template>
  <section v-if="!loading && staff.length && courses.length" class="mb-8">
    <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('pharmacistComplianceMatrix.heading') }}</h2>
    <div class="bg-white rounded-xl2 overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="border-b border-seafoam">
            <th class="text-left px-4 py-3 font-medium text-ink whitespace-nowrap">{{ t('pharmacistComplianceMatrix.staffColumn') }}</th>
            <th v-for="c in courses" :key="c.id" class="text-left px-4 py-3 font-medium text-ink whitespace-nowrap">{{ c.title }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in staff" :key="`${s.outlet}|${s.name}`" class="border-b border-seafoam last:border-0">
            <td class="px-4 py-3 whitespace-nowrap">
              <p class="font-medium text-ink">{{ s.name }}</p>
              <p class="text-xs text-slate">{{ s.outlet }}</p>
            </td>
            <td v-for="c in courses" :key="c.id" class="px-4 py-3 whitespace-nowrap">
              <template v-if="cell(s, c.topic).attempted">
                <span class="font-semibold" :class="cell(s, c.topic).passed ? 'text-aqua' : 'text-coral'">
                  {{ cell(s, c.topic).passed ? t('pharmacistComplianceMatrix.passed') : t('pharmacistComplianceMatrix.failed') }}
                  ({{ cell(s, c.topic).percentage }}%)
                </span>
                <p class="text-xs text-slate">{{ formatDate(cell(s, c.topic).date) }}</p>
              </template>
              <span v-else class="text-slate">{{ t('pharmacistComplianceMatrix.notAttempted') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
```

- [ ] **Step 2: Add EN/MS locale keys**

In `en.json`, add a new top-level block (alongside `supervisorPharmacistTagView` etc.):

```json
  "pharmacistComplianceMatrix": {
    "heading": "Pharmacist Course Compliance",
    "staffColumn": "Staff",
    "passed": "Passed",
    "failed": "Failed",
    "notAttempted": "Not attempted"
  },
```

In `ms.json`, add:

```json
  "pharmacistComplianceMatrix": {
    "heading": "Pematuhan Kursus Ahli Farmasi",
    "staffColumn": "Staf",
    "passed": "Lulus",
    "failed": "Gagal",
    "notAttempted": "Belum dicuba"
  },
```

- [ ] **Step 3: EN/MS key-parity check**

Run:
```bash
cd lautan-academy-frontend
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function flatten(obj, prefix='') {
  return Object.entries(obj).flatMap(([k,v]) => typeof v === 'object' ? flatten(v, prefix+k+'.') : [prefix+k]);
}
const enKeys = new Set(flatten(en));
const msKeys = new Set(flatten(ms));
console.log('Missing in ms:', [...enKeys].filter(k => !msKeys.has(k)));
console.log('Missing in en:', [...msKeys].filter(k => !enKeys.has(k)));
"
```
Expected: both arrays empty.

- [ ] **Step 4: `npm run build`**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build (component isn't imported anywhere yet, but must still compile standalone with no syntax errors).

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-frontend
git add src/components/PharmacistComplianceMatrix.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add PharmacistComplianceMatrix component"
```

---

### Task 4: Wire the matrix into all 4 manager-tier views

**Files:**
- Modify: `lautan-academy-frontend/src/views/OutletManagerResultsView.vue`
- Modify: `lautan-academy-frontend/src/views/WarehouseManagerResultsView.vue`
- Modify: `lautan-academy-frontend/src/views/AreaManagerDashboard.vue`
- Modify: `lautan-academy-frontend/src/views/SupervisorStaffComparisonView.vue`

**Interfaces:**
- Consumes: `PharmacistComplianceMatrix.vue` (Task 3).
- Produces: nothing new — leaf UI wiring, no other task depends on this.

- [ ] **Step 1: `OutletManagerResultsView.vue`**

Add the import after the existing `Pagination` import (line 21):

```js
import PharmacistComplianceMatrix from '../components/PharmacistComplianceMatrix.vue'
```

In the template, insert right after the CPD `v-else` section's closing `</section>` (after line 167, before the `<section>` at line 169 that starts "Video Training Heading"):

```html
        <PharmacistComplianceMatrix />

```

- [ ] **Step 2: `WarehouseManagerResultsView.vue`**

Add the import after the existing `Pagination` import (line 13):

```js
import PharmacistComplianceMatrix from '../components/PharmacistComplianceMatrix.vue'
```

In the template, insert immediately after the `<main class="max-w-3xl mx-auto px-6 py-8">` opening tag (line 61), before the existing `v-if="loading"` line:

```html
      <PharmacistComplianceMatrix />
```

(This view has no CPD Hours section to sit next to — Warehouse Manager never got one, since warehouse staff don't accrue CPD hours in `data.js`'s `warehouse_manager` scope branch. The matrix renders nothing here in practice, since Pharmacist Courses are retail-only — included anyway for tier parity, per the spec's explicit call.)

- [ ] **Step 3: `AreaManagerDashboard.vue`**

Add the import after the existing `Pagination` import (line 16):

```js
import PharmacistComplianceMatrix from '../components/PharmacistComplianceMatrix.vue'
```

In the template, insert right after the CPD `v-else` section's closing `</section>` (after line 172, before the `<div class="mb-6">` at line 174):

```html
        <PharmacistComplianceMatrix />

```

- [ ] **Step 4: `SupervisorStaffComparisonView.vue`**

Add the import after the existing `Pagination` import (line 12):

```js
import PharmacistComplianceMatrix from '../components/PharmacistComplianceMatrix.vue'
```

In the template, insert right after the CPD `v-else` section's closing `</section>` (after line 204):

```html
      <PharmacistComplianceMatrix />
```

- [ ] **Step 5: `npm run build`**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build.

- [ ] **Step 6: Live browser check**

As Supervisor, Area Manager, Outlet Manager, and Warehouse Manager (four separate logins): confirm the "Pharmacist Course Compliance" section appears on the first three when a tagged pharmacist + mandatory course exist in scope, correctly scoped (Outlet Manager sees only their outlet's pharmacist staff, Area Manager only their region's, Supervisor sees all); confirm it renders nothing (no heading, no empty table) for Warehouse Manager and for any tier with zero pharmacist staff in scope.

- [ ] **Step 7: Commit**

```bash
cd lautan-academy-frontend
git add src/views/OutletManagerResultsView.vue src/views/WarehouseManagerResultsView.vue src/views/AreaManagerDashboard.vue src/views/SupervisorStaffComparisonView.vue
git commit -m "feat: show pharmacist compliance matrix on all 4 manager-tier views"
```

---

### Task 5: Pharmacist self-export (Quiz History)

**Files:**
- Modify: `lautan-academy-frontend/src/views/QuizHistoryView.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `standardHistory`, `aiHistory`, `videoTrainings` (all already fetched in this view), `videoHoursByTopic`, `MODULE_QUIZ_HOURS`, `AI_PRACTICE_HOURS` (`composables/useCpdHours.js`, existing).
- Produces: nothing new — leaf UI change, no other task depends on this.

- [ ] **Step 1: Extend the `useCpdHours` import**

Change line 18:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, MODULE_QUIZ_HOURS, AI_PRACTICE_HOURS } from '../composables/useCpdHours'
```

- [ ] **Step 2: Add the CSV export function**

Add after the `cpdHoursThisYear` computed (currently ending at line 90):

```js
// Pharmacist self-export — a permanent personal record that survives
// Annual Data Reset purging old `results` rows. All-time, not scoped to
// cpdYear (the point is an archive, not a snapshot of one year). See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
function csvEscape(value) {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function downloadTrainingRecordCsv() {
  const hoursByTopic = videoHoursByTopic(videoTrainings.value)
  const rows = [
    ...standardHistory.value.map((h) => ({
      topic: h.Topic,
      date: h.Timestamp,
      hours: hoursByTopic.has(h.Topic) ? hoursByTopic.get(h.Topic) : MODULE_QUIZ_HOURS,
    })),
    ...aiHistory.value.map((h) => ({
      topic: h.Topic,
      date: h.Timestamp,
      hours: AI_PRACTICE_HOURS,
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date))

  const header = ['Topic', 'Date', 'Hours'].map(csvEscape).join(',')
  const body = rows.map((r) => [r.topic, new Date(r.date).toISOString().slice(0, 10), r.hours].map(csvEscape).join(','))
  const total = rows.reduce((sum, r) => sum + r.hours, 0)
  const footer = ['Total', '', total].map(csvEscape).join(',')

  const blob = new Blob(['﻿' + [header, ...body, footer].join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cpd-record-${auth.staff?.name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 3: Add the button to the template**

In the `v-if="auth.impersonating"` CPD section (lines 153-165), add the button after the existing hours-display `<div>` (after line 164, before the section's closing `</section>` at line 165):

```html
          <button
            v-if="auth.staff?.isPharmacist"
            type="button"
            @click="downloadTrainingRecordCsv"
            class="mt-3 text-sm font-medium text-aqua hover:underline"
          >
            {{ t('quizHistoryView.downloadTrainingRecord') }}
          </button>
```

- [ ] **Step 4: Add EN/MS locale keys**

In `en.json`'s `quizHistoryView` block, add after `"cpdComingSoon"` (or any existing key in that block):

```json
    "downloadTrainingRecord": "Download My Training Record",
```

In `ms.json`'s matching block, add:

```json
    "downloadTrainingRecord": "Muat Turun Rekod Latihan Saya",
```

- [ ] **Step 5: EN/MS key-parity check**

Re-run Task 3 Step 3's parity script. Expected: both arrays empty.

- [ ] **Step 6: `npm run build`**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build.

- [ ] **Step 7: Live browser check**

Log in as a Master-impersonated pharmacist-tagged staff member (real nav for Video Training/Pharmacist Courses isn't flipped live yet, so impersonation is the only way to reach the real, non-"Coming Soon" CPD section) with at least one Module Quiz and one AI Practice attempt on record. Confirm the "Download My Training Record" button appears only here (not for a non-pharmacist impersonated session, not in the "Coming Soon" branch for a real non-impersonated login), and clicking it downloads a CSV with correct `Topic,Date,Hours` rows sorted oldest-first and a correct `Total` footer row.

- [ ] **Step 8: Commit**

```bash
cd lautan-academy-frontend
git add src/views/QuizHistoryView.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add pharmacist self-export of training record"
```

---

### Task 6: CPD target 120hr → 60hr

**Files:**
- Modify: `lautan-academy-frontend/src/composables/useCpdHours.js`
- Modify: `lautan-academy-frontend/src/views/DashboardView.vue`
- Modify: `lautan-academy-frontend/src/views/AreaManagerDashboard.vue`
- Modify: `lautan-academy-frontend/src/views/OutletManagerResultsView.vue`
- Modify: `lautan-academy-frontend/src/views/QuizHistoryView.vue`
- Modify: `lautan-academy-frontend/src/views/SupervisorStaffComparisonView.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`
- Modify: `lautan-academy/PRODUCT.md`

**Interfaces:**
- Produces: `CPD_TARGET_HOURS` exported from `useCpdHours.js` (value `60`). No other task depends on this — it's a value change, not a new interface.

- [ ] **Step 1: Add the shared constant**

In `lautan-academy-frontend/src/composables/useCpdHours.js`, add after the existing `export const AI_PRACTICE_HOURS = 0.25` line:

```js
// Global CPD target, hours/calendar-year. Was 120, lowered to 60 — single
// source of truth so a future change only touches this file. See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
export const CPD_TARGET_HOURS = 60
```

- [ ] **Step 2: `DashboardView.vue`**

Add the import after the existing `useAuthStore` import (line 21):

```js
import { CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

Delete line 32:

```js
const CPD_TARGET_HOURS = 120
```

- [ ] **Step 3: `AreaManagerDashboard.vue`**

Change line 14:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

Delete line 29:

```js
const CPD_TARGET_HOURS = 120
```

- [ ] **Step 4: `OutletManagerResultsView.vue`**

Change line 19:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

Delete line 33:

```js
const CPD_TARGET_HOURS = 120
```

- [ ] **Step 5: `QuizHistoryView.vue`**

Change the import already extended in Task 5 Step 1:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, MODULE_QUIZ_HOURS, AI_PRACTICE_HOURS } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, MODULE_QUIZ_HOURS, AI_PRACTICE_HOURS, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

Delete line 32:

```js
const CPD_TARGET_HOURS = 120
```

- [ ] **Step 6: `SupervisorStaffComparisonView.vue`**

Change line 10:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

Delete line 26:

```js
const CPD_TARGET_HOURS = 120
```

- [ ] **Step 7: Update the i18n helper string**

In `en.json`, change the `videoHoursHelper` value:

```json
    "videoHoursHelper": "How many hours this video counts toward the 120hr/year target — set by you, not the video's real length.",
```

to:

```json
    "videoHoursHelper": "How many hours this video counts toward the 60hr/year target — set by you, not the video's real length.",
```

In `ms.json`, change:

```json
    "videoHoursHelper": "Berapa jam video ini dikira ke arah target 120 jam/tahun — anda yang tetapkan, bukan durasi sebenar video.",
```

to:

```json
    "videoHoursHelper": "Berapa jam video ini dikira ke arah target 60 jam/tahun — anda yang tetapkan, bukan durasi sebenar video.",
```

- [ ] **Step 8: Update `PRODUCT.md`**

Change line 42 (`"...expected to hit a fixed 120-hour/calendar-year"`) to say `60-hour/calendar-year`, and line 90 (`"...contributes toward the 120hr target)."`) to say `60hr target).`

- [ ] **Step 9: Grep-confirm no stray `120` CPD references remain**

Run:
```bash
cd lautan-academy-frontend
grep -rn "120" src/composables/useCpdHours.js src/views/DashboardView.vue src/views/AreaManagerDashboard.vue src/views/OutletManagerResultsView.vue src/views/QuizHistoryView.vue src/views/SupervisorStaffComparisonView.vue src/i18n/locales/en.json src/i18n/locales/ms.json
```
Expected: no output (`ResultView.vue`'s unrelated `:size="120"` pixel dimension is intentionally not in this file list — do not touch it).

Run: `grep -n "120" ../PRODUCT.md` (from `lautan-academy-frontend`, i.e. `lautan-academy/PRODUCT.md`)
Expected: no output.

- [ ] **Step 10: EN/MS key-parity check + `npm run build`**

Re-run Task 3 Step 3's parity script (expect empty) and `npm run build` (expect clean).

- [ ] **Step 11: Live browser check**

Confirm Dashboard's progress line, Quiz History's CPD section, and all 3 manager CPD summaries (Outlet, Area, Supervisor) all show `/ 60` as the target, not `/ 120`.

- [ ] **Step 12: Commit**

```bash
cd lautan-academy-frontend
git add src/composables/useCpdHours.js src/views/DashboardView.vue src/views/AreaManagerDashboard.vue src/views/OutletManagerResultsView.vue src/views/QuizHistoryView.vue src/views/SupervisorStaffComparisonView.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: lower CPD target from 120hr to 60hr, centralize the constant"
cd ..
git add PRODUCT.md
git commit -m "docs: update CPD target to 60hr/year in PRODUCT.md"
```

---

### Task 7: Final whole-feature verification

**Files:** none (verification only)

- [ ] **Step 1: Re-run every curl check from Task 1** against the final code — confirms no later task broke the endpoint.

- [ ] **Step 2: `npm run build` clean, EN/MS parity clean** (final full-file re-check, not per-task).

- [ ] **Step 3: Full live browser click-through** using disposable/throwaway test data (tag/untag afterward, same caution as every prior subsystem):
  - Tag a staff member Pharmacist (Supervisor), add a mandatory course, confirm the compliance matrix appears correctly scoped on Outlet Manager, Area Manager, and Supervisor views, and correctly renders nothing on Warehouse Manager's view.
  - Have the tagged staff member (via impersonation) complete the course below 70%, confirm the matrix shows "Failed"; complete it again above 70%, confirm it flips to "Passed" and stays "Passed" even after a subsequent lower-scoring retake.
  - Confirm the "Download My Training Record" button is pharmacist-only and produces a correct CSV.
  - Confirm 60hr (not 120hr) shows as the CPD target everywhere it's displayed.
  - Untag the test staff member and remove any throwaway course/results rows created for this pass.

- [ ] **Step 4: Update `MEMORY.md`**

Per this repo's `CLAUDE.md` rule 5, add a `[DONE, NOT PUSHED]` entry to `MEMORY.md` summarizing what shipped (mirror the style of the existing CPD Hours Tracking / Pharmacist Tag entries), and remove the `[PENDING] CPD sub-project C` line it replaces.

- [ ] **Step 5: Prompt the user to `/clear`**

Per `CLAUDE.md` rule 5 — task complete, suggest resetting the session.
