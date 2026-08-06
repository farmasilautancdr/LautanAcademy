# Staff Review + Results Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add topic/year filters + date badge boxes to the three manager-side "Staff Results" pages, add a new read-only "Staff Review" page for Outlet Managers to see Area Manager assessments of their staff, and fix a stray label.

**Architecture:** Pure frontend (`lautan-academy-frontend`), no backend changes. Reuses the `dateBadge`/filter pattern already shipped in `QuizHistoryView.vue`'s Assessment Review section. The new Staff Review page reuses the `reports` array `api.getScopedData()` already returns for `outlet_manager` scope (backend: `lautan-academy-backend/src/routes/data.js:39-49`) — no new API calls.

**Tech Stack:** Vue 3 `<script setup>`, Vue Router, Tailwind utility classes. No test framework exists in this repo (`lautan-academy-frontend/package.json` has no test runner) — verification is `npm run build` (catches template/compile errors) plus manual route/data-shape review, matching how prior tasks in this codebase (Manager Access page, Assessment Review) were verified.

## Global Constraints

- No backend changes. All data already flows through `api.getScopedData()`.
- Flex-item `<input>`/`<select>` inside a flex row must have `min-w-0` if it can shrink below its intrinsic width (recurring mobile-overflow bug in this codebase — see `ManageStaffPanel.vue` history).
- Match existing code conventions in each file over "best practice" from elsewhere.
- User-facing strings in this codebase are being kept EN-only in manager-side views (no `_ms` variants exist anywhere in the manager views read for this plan) — do not introduce `_en`/`_ms` pairs here, that pattern is staff-facing only.
- Date badge box markup/classes and the `MONTHS` array must match `QuizHistoryView.vue:59-63` exactly (`bg-aqualight`, `text-aqua`, `text-deepsea`, `w-11` box) — this is a repeated visual pattern, not a new one.

---

### Task 1: Outlet Manager Staff Results — filters + date badge

**Files:**
- Modify: `lautan-academy-frontend/src/views/OutletManagerResultsView.vue`

**Interfaces:**
- Consumes: existing `standardHistory`, `aiHistory` refs (already populated from `api.getScopedData()`).
- Produces: nothing consumed by other tasks — this task is self-contained.

- [ ] **Step 1: Add filter state and computed lists to `<script setup>`**

In `OutletManagerResultsView.vue`, after the existing `wrongAnswers`/`aiWrongAnswers`/`loading` refs (currently lines 21-25), add:

```js
const standardYear = ref('ALL')
const standardTopic = ref('ALL')
const aiYear = ref('ALL')
const aiTopic = ref('ALL')

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

const standardYears = computed(() => [...new Set(standardHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const standardTopics = computed(() => [...new Set(standardHistory.value.map((h) => h.Topic))].sort())
const filteredStandardHistory = computed(() => standardHistory.value.filter((h) => {
  if (standardYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== standardYear.value) return false
  if (standardTopic.value !== 'ALL' && h.Topic !== standardTopic.value) return false
  return true
}))

const aiYears = computed(() => [...new Set(aiHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const aiTopics = computed(() => [...new Set(aiHistory.value.map((h) => h.Topic))].sort())
const filteredAiHistory = computed(() => aiHistory.value.filter((h) => {
  if (aiYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== aiYear.value) return false
  if (aiTopic.value !== 'ALL' && h.Topic !== aiTopic.value) return false
  return true
}))
```

Also change the `import` line (currently line 14) from:

```js
import { ref, onMounted } from 'vue'
```

to:

```js
import { ref, computed, onMounted } from 'vue'
```

- [ ] **Step 2: Add filter dropdowns + swap in date badge, Module Quiz section**

Replace the Module Quiz `<section>` (currently lines 57-79) with:

```html
        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">Module Quiz</h2>
          <div v-if="standardHistory.length === 0" class="text-slate text-sm">No attempts yet.</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
                <option value="ALL">All years</option>
                <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="standardTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
                <option value="ALL">All topics</option>
                <option v-for="t in standardTopics" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div v-if="filteredStandardHistory.length === 0" class="text-slate text-sm">No attempts match this filter.</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="(h, i) in filteredStandardHistory" :key="i" class="px-5 py-3">
                <summary class="flex items-center gap-3 cursor-pointer">
                  <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                    <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                    <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
                  </div>
                  <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                    {{ h.Score }}
                  </span>
                </summary>
                <div v-if="wrongsForStandard(h.Name, h.Topic).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h.Name, h.Topic)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>
```

Note: the previous per-row date text (`{{ new Date(h.Timestamp).toLocaleDateString() }}`) is dropped — the badge box now carries that information. `wrongsForStandard`/`wrongsForAi` functions (existing, lines 38-43) are unchanged and still referenced.

- [ ] **Step 3: Same treatment for AI Practice section**

Replace the AI Practice `<section>` (currently lines 81-103) with:

```html
        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">AI Practice</h2>
          <div v-if="aiHistory.length === 0" class="text-slate text-sm">No attempts yet.</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
                <option value="ALL">All years</option>
                <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="aiTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
                <option value="ALL">All topics</option>
                <option v-for="t in aiTopics" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div v-if="filteredAiHistory.length === 0" class="text-slate text-sm">No attempts match this filter.</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in filteredAiHistory" :key="h.AttemptID" class="px-5 py-3">
                <summary class="flex items-center gap-3 cursor-pointer">
                  <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                    <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                    <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
                  </div>
                  <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                    {{ h.Score }}
                  </span>
                </summary>
                <div v-if="wrongsForAi(h.AttemptID).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForAi(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>
```

- [ ] **Step 4: Verify — build + manual check**

Run: `cd lautan-academy-frontend && npm run build`
Expected: build succeeds, no Vue compiler errors.

Run the dev server (`npm run dev`) and in a second terminal:
`curl -s http://localhost:5173/src/views/OutletManagerResultsView.vue | head -5`
Expected: 200, no error overlay markers in output (this only confirms the dev pipeline transforms the file — it does not substitute for an actual browser check, note this in the task report).

- [ ] **Step 5: Commit**

```bash
git add lautan-academy-frontend/src/views/OutletManagerResultsView.vue
git commit -m "feat: add topic/year filters + date badges to Outlet Manager Staff Results"
```

---

### Task 2: Warehouse Manager Staff Results — filter + date badge

**Files:**
- Modify: `lautan-academy-frontend/src/views/WarehouseManagerResultsView.vue`

**Interfaces:**
- Consumes: existing `history` ref.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add filter state to `<script setup>`**

Change the import (currently line 8) from:

```js
import { ref, onMounted } from 'vue'
```

to:

```js
import { ref, computed, onMounted } from 'vue'
```

After the existing `wrongAnswers`/`loading` refs (currently lines 15-16), add:

```js
const filterYear = ref('ALL')
const filterTopic = ref('ALL')

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

const filterYears = computed(() => [...new Set(history.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const filterTopics = computed(() => [...new Set(history.value.map((h) => h.Topic))].sort())
const filteredHistory = computed(() => history.value.filter((h) => {
  if (filterYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== filterYear.value) return false
  if (filterTopic.value !== 'ALL' && h.Topic !== filterTopic.value) return false
  return true
}))
```

- [ ] **Step 2: Add filter dropdowns + date badge to the list**

Replace the `<main>` block (currently lines 39-61) with:

```html
    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="history.length === 0" class="text-slate text-sm">No attempts yet.</div>
      <template v-else>
        <div class="flex flex-wrap gap-2 mb-3">
          <select v-model="filterYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">All years</option>
            <option v-for="y in filterYears" :key="y" :value="y">{{ y }}</option>
          </select>
          <select v-model="filterTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">All topics</option>
            <option v-for="t in filterTopics" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div v-if="filteredHistory.length === 0" class="text-slate text-sm">No attempts match this filter.</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <details v-for="h in filteredHistory" :key="h.AttemptID" class="px-5 py-3">
            <summary class="flex items-center gap-3 cursor-pointer">
              <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
              </div>
              <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                {{ h.Score }}
              </span>
            </summary>
            <div v-if="wrongsFor(h.AttemptID).length" class="mt-3 space-y-2">
              <div v-for="(w, j) in wrongsFor(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
                <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
              </div>
            </div>
          </details>
        </div>
      </template>
    </main>
```

- [ ] **Step 3: Verify — build**

Run: `cd lautan-academy-frontend && npm run build`
Expected: build succeeds, no Vue compiler errors.

- [ ] **Step 4: Commit**

```bash
git add lautan-academy-frontend/src/views/WarehouseManagerResultsView.vue
git commit -m "feat: add topic/year filter + date badge to Warehouse Manager Staff Results"
```

---

### Task 3: Area Manager Staff Results — filters + date badge

**Files:**
- Modify: `lautan-academy-frontend/src/views/AreaManagerDashboard.vue`

**Interfaces:**
- Consumes: existing `allResults` ref, existing `outletFilter` ref (kept as-is).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add filter state to `<script setup>`**

The import line (currently line 10) is already `import { ref, computed, onMounted } from 'vue'` — no change needed there.

After the existing `outletFilter` ref (currently line 22), add:

```js
const yearFilter = ref('ALL')
const topicFilter = ref('ALL')

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}
```

Replace the existing `results` computed (currently line 33):

```js
const results = computed(() => outletFilter.value === 'ALL' ? allResults.value : allResults.value.filter((r) => r.Outlet === outletFilter.value))
```

with a version that also applies year/topic, and add the year/topic option lists (derived from the outlet-filtered set, so choosing an outlet narrows the year/topic options too — same cascading behavior `AreaManagerReviewsView.vue`'s outlet→staff picker already uses elsewhere in this codebase):

```js
const outletScopedResults = computed(() => outletFilter.value === 'ALL' ? allResults.value : allResults.value.filter((r) => r.Outlet === outletFilter.value))
const resultYears = computed(() => [...new Set(outletScopedResults.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const resultTopics = computed(() => [...new Set(outletScopedResults.value.map((r) => r.Topic))].sort())
const results = computed(() => outletScopedResults.value.filter((r) => {
  if (yearFilter.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== yearFilter.value) return false
  if (topicFilter.value !== 'ALL' && r.Topic !== topicFilter.value) return false
  return true
}))
```

- [ ] **Step 2: Add filter dropdowns + swap in date badge**

Replace the template body (currently lines 42-80) with:

```html
<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ managerLabel }}</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Results — {{ areaLabel }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="flex flex-wrap gap-2 mb-6">
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All outlets in region</option>
          <option v-for="o in regionOutlets" :key="o" :value="o">{{ o }}</option>
        </select>
        <select v-model="yearFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All years</option>
          <option v-for="y in resultYears" :key="y" :value="y">{{ y }}</option>
        </select>
        <select v-model="topicFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All topics</option>
          <option v-for="t in resultTopics" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="results.length === 0" class="text-slate text-sm">No results match this filter.</div>
      <div v-else class="space-y-3">
        <details v-for="(r, i) in results" :key="i" class="bg-white rounded-xl2 shadow-sm">
          <summary class="flex items-center gap-3 px-5 py-3 cursor-pointer">
            <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
              <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(r.Timestamp).month }}</p>
              <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(r.Timestamp).day }}</p>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ r.Name }} · {{ r.Topic }}</p>
              <p class="text-xs text-slate truncate">{{ r.Outlet }}</p>
            </div>
            <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(r.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ r.Score }}
            </span>
          </summary>
          <div v-if="wrongsFor(r.Name, r.Outlet, r.Topic).length" class="px-5 pb-4 space-y-2">
            <div v-for="(w, j) in wrongsFor(r.Name, r.Outlet, r.Topic)" :key="j" class="bg-seafoam rounded-lg p-3">
              <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
              <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
            </div>
          </div>
        </details>
      </div>
    </main>
  </div>
</template>
```

Note: the empty-state text changes from the old outlet-only phrasing (`No results yet{{ outletFilter === 'ALL' ? ... }}`) to a flat "No results match this filter." — now covers three filters, not one, so a single generic message is clearer than trying to enumerate three filter states in prose.

- [ ] **Step 3: Verify — build**

Run: `cd lautan-academy-frontend && npm run build`
Expected: build succeeds, no Vue compiler errors.

- [ ] **Step 4: Commit**

```bash
git add lautan-academy-frontend/src/views/AreaManagerDashboard.vue
git commit -m "feat: add year/topic filters + date badge to Area Manager Staff Results"
```

---

### Task 4: Outlet Manager "Staff Review" page

**Files:**
- Create: `lautan-academy-frontend/src/views/OutletManagerStaffReviewView.vue`
- Modify: `lautan-academy-frontend/src/router/index.js`
- Modify: `lautan-academy-frontend/src/components/AppSidebar.vue`

**Interfaces:**
- Consumes: `api.getScopedData()` (existing, `lautan-academy-frontend/src/api/client.js:45-46`) — returns `.reports` array with fields `Timestamp, Manager, Outlet, 'Staff Name', 'Quiz Score', 'Training Title', 'Skill Level', 'Performance Gaps', Recommendations, Fluency, 'Product Knowledge Comments'` (backend: `lautan-academy-backend/src/routes/data.js:104-109`).
- Produces: route name `manager-staff-review` at path `/manager/staff-review`, used only by the sidebar link added in this task.

- [ ] **Step 1: Create the view**

Create `lautan-academy-frontend/src/views/OutletManagerStaffReviewView.vue`:

```vue
<script setup>
// Read-only view of Area Manager assessments for this outlet's staff —
// same year/topic filter + date badge pattern as the staff-side Assessment
// Review section (QuizHistoryView.vue), but spans every staff member at
// the outlet rather than one person, so each card also shows Staff Name.
// Warehouse Manager has no equivalent: backend never returns reports for
// warehouse_manager scope (data.js) — matches GAS, which never had a
// Product Knowledge assessment flow for warehouse staff.
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const outlet = auth.manager?.outlet

const reports = ref([])
const loading = ref(true)

const reportYear = ref('ALL')
const reportTopic = ref('ALL')

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function skillLevelColor(level) {
  if (level === 'HIGH') return 'text-aqua'
  if (level === 'LOW') return 'text-coral'
  return 'text-ink'
}

const reportYears = computed(() => [...new Set(reports.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const reportTopics = computed(() => [...new Set(reports.value.map((r) => r['Training Title']))].sort())

const filteredReports = computed(() => reports.value.filter((r) => {
  if (reportYear.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== reportYear.value) return false
  if (reportTopic.value !== 'ALL' && r['Training Title'] !== reportTopic.value) return false
  return true
}))

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Outlet Manager</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Review — {{ outlet }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="reports.length === 0" class="bg-white rounded-xl2 p-6 text-center">
        <p class="text-slate text-sm">No assessments filed for this outlet yet.</p>
      </div>
      <template v-else>
        <div class="flex flex-wrap gap-2 mb-3">
          <select v-model="reportYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">All years</option>
            <option v-for="y in reportYears" :key="y" :value="y">{{ y }}</option>
          </select>
          <select v-model="reportTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">All topics</option>
            <option v-for="t in reportTopics" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div v-if="filteredReports.length === 0" class="bg-white rounded-xl2 p-6 text-center">
          <p class="text-slate text-sm">No assessments match this filter.</p>
        </div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <details v-for="(r, i) in filteredReports" :key="i" class="px-5 py-3.5">
            <summary class="flex items-center gap-4 cursor-pointer">
              <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(r.Timestamp).month }}</p>
                <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(r.Timestamp).day }}</p>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ r['Staff Name'] }} · {{ r['Training Title'] }}</p>
                <p class="text-xs text-slate">Filed by {{ r.Manager }}</p>
              </div>
              <span class="text-sm font-display font-semibold shrink-0" :class="skillLevelColor(r['Skill Level'])">{{ r['Skill Level'] }}</span>
            </summary>
            <div class="mt-3 space-y-2">
              <div class="bg-seafoam rounded-lg p-3">
                <p class="text-xs text-slate">Quiz score: <span class="font-medium text-ink">{{ r['Quiz Score'] }}</span> · Competency: <span class="font-medium text-ink">{{ r.Fluency ?? '—' }}/10</span></p>
              </div>
              <div v-if="r['Product Knowledge Comments']" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-ink">Product knowledge</p>
                <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r['Product Knowledge Comments'] }}</p>
              </div>
              <div v-if="r['Performance Gaps']" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-ink">Performance gaps</p>
                <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r['Performance Gaps'] }}</p>
              </div>
              <div v-if="r.Recommendations" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-ink">Recommendations</p>
                <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r.Recommendations }}</p>
              </div>
            </div>
          </details>
        </div>
      </template>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Register the route**

In `lautan-academy-frontend/src/router/index.js`, find the line (currently line 55):

```js
    { path: '/manager/results', name: 'manager-results', component: OutletManagerResultsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
```

Add the import immediately after that same line (currently `router/index.js:18`):

```js
import OutletManagerResultsView from '../views/OutletManagerResultsView.vue'
import OutletManagerStaffReviewView from '../views/OutletManagerStaffReviewView.vue'
```

Then add a new route immediately after the `/manager/results` route line:

```js
    { path: '/manager/staff-review', name: 'manager-staff-review', component: OutletManagerStaffReviewView, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
```

- [ ] **Step 3: Add the sidebar nav item — Outlet Manager only**

In `lautan-academy-frontend/src/components/AppSidebar.vue`, the "Outlet Performance" group (currently lines 83-88) is built inside the `isOutletOrWarehouseManager` block and is currently shared identically by both roles:

```js
    groups.push({
      label: 'Outlet Performance',
      items: [
        { label: 'Staff Results', to: managerResultsPath.value, icon: 'chart' },
      ],
    })
```

Replace it with a version that adds "Staff Review" only when the logged-in role is `outlet_manager`:

```js
    const performanceItems = [{ label: 'Staff Results', to: managerResultsPath.value, icon: 'chart' }]
    if (managerRole.value === 'outlet_manager') {
      performanceItems.push({ label: 'Staff Review', to: '/manager/staff-review', icon: 'clipboard' })
    }
    groups.push({ label: 'Outlet Performance', items: performanceItems })
```

The `clipboard` icon already exists in the `ICONS` map (currently line 163) — reused, not new.

- [ ] **Step 4: Verify — build**

Run: `cd lautan-academy-frontend && npm run build`
Expected: build succeeds, no Vue compiler errors, no unresolved import errors for `OutletManagerStaffReviewView`.

Manually re-read the edited section of `AppSidebar.vue` to confirm the `if (managerRole.value === 'outlet_manager')` branch is inside the `isOutletOrWarehouseManager.value` block (not replacing it) — Warehouse Manager must still get "Staff Results" with no "Staff Review" item.

- [ ] **Step 5: Commit**

```bash
git add lautan-academy-frontend/src/views/OutletManagerStaffReviewView.vue lautan-academy-frontend/src/router/index.js lautan-academy-frontend/src/components/AppSidebar.vue
git commit -m "feat: add read-only Staff Review page for Outlet Manager"
```

---

### Task 5: Product Knowledge label fix

**Files:**
- Modify: `lautan-academy-frontend/src/views/AreaManagerReviewsView.vue:220`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Fix the label**

In `AreaManagerReviewsView.vue`, change line 220 from:

```html
            <label class="block text-sm font-medium text-ink mb-1">Product Knowledge — comments</label>
```

to:

```html
            <label class="block text-sm font-medium text-ink mb-1">Product Knowledge</label>
```

The `v-model="productKnowledgeComments"` binding on the `<textarea>` immediately below (line 221) is unchanged — only the visible label text changes, not the underlying field name.

- [ ] **Step 2: Verify — build**

Run: `cd lautan-academy-frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/views/AreaManagerReviewsView.vue
git commit -m "fix: drop stray 'comments' suffix from Product Knowledge label"
```
