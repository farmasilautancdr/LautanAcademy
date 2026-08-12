# Results Filters & Source-Split Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split every merged Video Training + Module Quiz list into two real
sections, add AI Practice as its own section in Area Manager, add
year/topic/staff-name filtering consistently across Outlet Manager, Area
Manager, Supervisor Staff Comparison, and staff Quiz History, and make every
CPD Hours summary year-filterable instead of hardcoded to the current
calendar year.

**Architecture:** Frontend-only. One new export on the existing
`useCpdHours.js` composable (`splitByVideoTopic`) is reused by all four
views to separate Video Training rows from Module Quiz rows (same `results`
table, distinguished by topic membership in `video_trainings`). Every other
change is new local refs/computeds inside each view, following that view's
own existing filter-dropdown idiom (flat `ref` per filter, no shared
filter-state module — matches the codebase's existing style in
`OutletManagerResultsView.vue`/`AreaManagerDashboard.vue`).

**Tech Stack:** Same as every other frontend task — Vue 3, vue-i18n. No new
dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-13-results-filters-sections-design.md` — read it first for the full rationale behind every filter-scope decision below.
- Bilingual EN/MS: every new user-facing string needs both `en.json` and `ms.json` entries, same key, same nesting, in the same task as the code that uses it.
- No new frameworks/libraries, no backend changes.
- No test framework in this repo — verification is `npm run build` + EN/MS key-parity check + live browser check (Playwright, using minted JWTs injected into `localStorage`, same technique the CPD Hours Tracking plan used — no real manager/supervisor PINs available).
- Frontend repo root for all tasks: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend`.
- CPD year dropdowns have **no "All years" option** (CPD is inherently a per-calendar-year target) — options are the current year plus any year with data, defaulting to the current year. Quiz-section year/topic/staff dropdowns keep the existing "ALL" default used everywhere else in this codebase.
- Existing `cpdHeading` strings ("CPD Hours (this year)") become misleading once a year dropdown exists — this plan updates them to just "CPD Hours" in every view that already has one (Outlet Manager, Area Manager, Supervisor), and uses the same plain "CPD Hours" wording for the new one in Quiz History.

---

### Task 1: `useCpdHours.js` — add `splitByVideoTopic`

**Files:**
- Modify: `src/composables/useCpdHours.js`

**Interfaces:**
- Produces: `splitByVideoTopic(results, hoursByTopic)` → `{ video: [], moduleQuiz: [] }`. `hoursByTopic` is the `Map<topic, hours>` returned by the existing `videoHoursByTopic()` export. Consumed by Tasks 2-5.

- [ ] **Step 1: Add the export**

In `src/composables/useCpdHours.js`, add this after the existing
`videoHoursByTopic` function (before `hoursByStaff`):

```js
// Splits a `results` array (Video Training + Module Quiz share one table)
// into the two sources by topic membership — the same check hoursByStaff()
// already does internally, exposed standalone so views can render them as
// separate sections instead of only summing them together. See
// docs/superpowers/specs/2026-08-13-results-filters-sections-design.md.
export function splitByVideoTopic(results, hoursByTopic) {
  const video = []
  const moduleQuiz = []
  for (const r of results) {
    (hoursByTopic.has(r.Topic) ? video : moduleQuiz).push(r)
  }
  return { video, moduleQuiz }
}
```

- [ ] **Step 2: Verify build is clean**

Run: `npm run build`
Expected: clean (this export isn't imported anywhere yet).

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Hafiz\projects\lautan-academy
git add lautan-academy-frontend/src/composables/useCpdHours.js
git commit -m "Add splitByVideoTopic to useCpdHours composable

Splits a results array into Video Training and Module Quiz subsets
by topic membership — the same check hoursByStaff() already does
internally, now reusable by views that need to render the two
sources as separate lists instead of just summing them."
```

---

### Task 2: Outlet Manager — split sections, add staff-name filter, CPD year filter

**Files:**
- Modify: `src/views/OutletManagerResultsView.vue`
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `splitByVideoTopic`, `videoHoursByTopic`, `hoursByStaff` (Task 1 + existing).

- [ ] **Step 1: Split `standardHistory` into Video Training and Module Quiz, add all new filter refs**

In `src/views/OutletManagerResultsView.vue`, change the import line:

```js
import { videoHoursByTopic, hoursByStaff } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
```

Change:

```js
const standardYear = ref('ALL')
const standardTopic = ref('ALL')
const aiYear = ref('ALL')
const aiTopic = ref('ALL')
```

to:

```js
const videoYear = ref('ALL')
const videoTopic = ref('ALL')
const videoStaff = ref('ALL')
const standardYear = ref('ALL')
const standardTopic = ref('ALL')
const standardStaff = ref('ALL')
const aiYear = ref('ALL')
const aiTopic = ref('ALL')
const aiStaff = ref('ALL')
const cpdYear = ref(new Date().getFullYear())
```

Change:

```js
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

to:

```js
// standardHistory carries every Video Training + Module Quiz result for
// this outlet (both write into the same results table, distinguished only
// by which topic namespace they belong to) — split once here, both
// sections below read from this.
const splitStandard = computed(() => splitByVideoTopic(standardHistory.value, videoHoursByTopic(videoTrainings.value)))
const videoTrainingHistory = computed(() => splitStandard.value.video)
const moduleQuizHistory = computed(() => splitStandard.value.moduleQuiz)

const videoYears = computed(() => [...new Set(videoTrainingHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const videoTopics = computed(() => [...new Set(videoTrainingHistory.value.map((h) => h.Topic))].sort())
const videoStaffNames = computed(() => [...new Set(videoTrainingHistory.value.map((h) => h.Name))].sort())
const filteredVideoHistory = computed(() => videoTrainingHistory.value.filter((h) => {
  if (videoYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== videoYear.value) return false
  if (videoTopic.value !== 'ALL' && h.Topic !== videoTopic.value) return false
  if (videoStaff.value !== 'ALL' && h.Name !== videoStaff.value) return false
  return true
}))

const standardYears = computed(() => [...new Set(moduleQuizHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const standardTopics = computed(() => [...new Set(moduleQuizHistory.value.map((h) => h.Topic))].sort())
const standardStaffNames = computed(() => [...new Set(moduleQuizHistory.value.map((h) => h.Name))].sort())
const filteredStandardHistory = computed(() => moduleQuizHistory.value.filter((h) => {
  if (standardYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== standardYear.value) return false
  if (standardTopic.value !== 'ALL' && h.Topic !== standardTopic.value) return false
  if (standardStaff.value !== 'ALL' && h.Name !== standardStaff.value) return false
  return true
}))

const aiYears = computed(() => [...new Set(aiHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const aiTopics = computed(() => [...new Set(aiHistory.value.map((h) => h.Topic))].sort())
const aiStaffNames = computed(() => [...new Set(aiHistory.value.map((h) => h.Name))].sort())
const filteredAiHistory = computed(() => aiHistory.value.filter((h) => {
  if (aiYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== aiYear.value) return false
  if (aiTopic.value !== 'ALL' && h.Topic !== aiTopic.value) return false
  if (aiStaff.value !== 'ALL' && h.Name !== aiStaff.value) return false
  return true
}))

// CPD year dropdown always offers the current year even with zero data yet,
// plus any year real attempts exist for — no "ALL" option, CPD is
// inherently per-calendar-year (see plan's Global Constraints).
const cpdYears = computed(() => {
  const years = new Set([...standardHistory.value, ...aiHistory.value].map((h) => new Date(h.Timestamp).getFullYear()))
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
})
```

- [ ] **Step 2: Wire `cpdSummary` to the new year filter**

Change:

```js
const cpdSummary = computed(() => hoursByStaff(standardHistory.value, aiHistory.value, videoHoursByTopic(videoTrainings.value)))
```

to:

```js
const cpdSummary = computed(() => hoursByStaff(standardHistory.value, aiHistory.value, videoHoursByTopic(videoTrainings.value), cpdYear.value))
```

- [ ] **Step 3: Add the CPD year `<select>`**

In the template, change:

```html
        <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.cpdHeading') }}</h2>
          <div class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="s in cpdSummary" :key="s.name" class="px-5 py-3 flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
              <span class="text-sm font-display font-semibold shrink-0" :class="s.hours >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
                {{ t('outletManagerResultsView.cpdHoursOfTarget', { hours: s.hours, target: CPD_TARGET_HOURS }) }}
              </span>
            </div>
          </div>
        </section>
```

to:

```html
        <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('outletManagerResultsView.cpdHeading') }}</h2>
            <select v-model.number="cpdYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option v-for="y in cpdYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="s in cpdSummary" :key="s.name" class="px-5 py-3 flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
              <span class="text-sm font-display font-semibold shrink-0" :class="s.hours >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
                {{ t('outletManagerResultsView.cpdHoursOfTarget', { hours: s.hours, target: CPD_TARGET_HOURS }) }}
              </span>
            </div>
          </div>
        </section>
```

- [ ] **Step 4: Split the Module Quiz section into Video Training + Module Quiz, add staff filters to both plus AI Practice**

Change:

```html
        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.moduleQuizHeading') }}</h2>
          <div v-if="standardHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="standardTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in standardTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
            </div>
            <div v-if="filteredStandardHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in filteredStandardHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3">
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
                <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: w['Question Text'] }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.aiPracticeHeading') }}</h2>
          <div v-if="aiHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="aiTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in aiTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
            </div>
            <div v-if="filteredAiHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
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
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: w['Question Text'] }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>
```

to:

```html
        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.videoTrainingHeading') }}</h2>
          <div v-if="videoTrainingHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="videoYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in videoYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="videoTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in videoTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
              <select v-model="videoStaff" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allStaff') }}</option>
                <option v-for="n in videoStaffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div v-if="filteredVideoHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in filteredVideoHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3">
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
                <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: w['Question Text'] }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.moduleQuizHeading') }}</h2>
          <div v-if="moduleQuizHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="standardTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in standardTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
              <select v-model="standardStaff" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allStaff') }}</option>
                <option v-for="n in standardStaffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div v-if="filteredStandardHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in filteredStandardHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3">
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
                <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: w['Question Text'] }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.aiPracticeHeading') }}</h2>
          <div v-if="aiHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="aiTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in aiTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
              <select v-model="aiStaff" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allStaff') }}</option>
                <option v-for="n in aiStaffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div v-if="filteredAiHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
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
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: w['Question Text'] }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>
```

- [ ] **Step 5: Add the i18n keys**

In `src/i18n/locales/en.json`, inside `outletManagerResultsView`, change:

```json
    "moduleQuizHeading": "Module Quiz",
    "noAttemptsYet": "No attempts yet.",
    "allYears": "All years",
    "allTopics": "All topics",
    "noAttemptsFiltered": "No attempts match this filter.",
    "questionPrefix": "Q: {text}",
    "correctLabel": "✓ Correct: {text}",
    "aiPracticeHeading": "AI Practice",
    "cpdHeading": "CPD Hours (this year)",
```

to:

```json
    "videoTrainingHeading": "Video Training",
    "moduleQuizHeading": "Module Quiz",
    "noAttemptsYet": "No attempts yet.",
    "allYears": "All years",
    "allTopics": "All topics",
    "allStaff": "All staff",
    "noAttemptsFiltered": "No attempts match this filter.",
    "questionPrefix": "Q: {text}",
    "correctLabel": "✓ Correct: {text}",
    "aiPracticeHeading": "AI Practice",
    "cpdHeading": "CPD Hours",
```

In `src/i18n/locales/ms.json`, inside `outletManagerResultsView`, change:

```json
    "moduleQuizHeading": "Modul Kuiz",
    "noAttemptsYet": "Belum ada percubaan.",
    "allYears": "Semua tahun",
    "allTopics": "Semua topik",
    "noAttemptsFiltered": "Tiada percubaan sepadan dengan penapis ini.",
    "questionPrefix": "S: {text}",
    "correctLabel": "✓ Betul: {text}",
    "aiPracticeHeading": "Latihan AI",
    "cpdHeading": "Jam CPD (tahun ini)",
```

to:

```json
    "videoTrainingHeading": "Latihan Video",
    "moduleQuizHeading": "Modul Kuiz",
    "noAttemptsYet": "Belum ada percubaan.",
    "allYears": "Semua tahun",
    "allTopics": "Semua topik",
    "allStaff": "Semua staf",
    "noAttemptsFiltered": "Tiada percubaan sepadan dengan penapis ini.",
    "questionPrefix": "S: {text}",
    "correctLabel": "✓ Betul: {text}",
    "aiPracticeHeading": "Latihan AI",
    "cpdHeading": "Jam CPD",
```

(Read the file first to confirm the exact existing MS values shown above
still match what's actually there — if any differ, keep the existing value
and only add the new keys, don't overwrite a value that's already there.)

- [ ] **Step 6: Verify build is clean**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Verify EN/MS key parity**

```bash
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(obj, prefix='') { let out = []; for (const k in obj) { const path = prefix ? prefix+'.'+k : k; if (typeof obj[k] === 'object' && obj[k] !== null) out = out.concat(keys(obj[k], path)); else out.push(path); } return out; }
const enKeys = new Set(keys(en)); const msKeys = new Set(keys(ms));
console.log('Missing in MS:', [...enKeys].filter(k => !msKeys.has(k)));
console.log('Missing in EN:', [...msKeys].filter(k => !enKeys.has(k)));
"
```

Expected: both arrays empty.

- [ ] **Step 8: Manual verification — live browser**

Insert temporary test data: a `video_trainings` row + matching `video_questions` row (topic `PLAN_TEST_OM_VIDEO`), a `results` row for that topic, a second `results` row for a plain module-quiz topic, an `ai_results` row — all for the same outlet/staff a minted `outlet_manager` JWT scopes to (same pattern as the CPD Hours plan's own verification). Log in via the minted token in `localStorage` (`lautan_token`/`lautan_manager`), navigate to `/manager/results`, confirm: three sections now render (Video Training / Module Quiz / AI Practice), each with its own year/topic/staff dropdowns; picking a staff name in one section doesn't affect the other two; the CPD section shows a year dropdown and the number changes when picking a different year with no data for it (should show `0 / 120 hrs` or omit that staff if `cpdSummary` filters empty — confirm `hoursByStaff`'s year param actually narrows the sum). Clean up test rows afterward.

- [ ] **Step 9: Commit**

```bash
cd C:\Users\Hafiz\projects\lautan-academy
git add lautan-academy-frontend/src/views/OutletManagerResultsView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Split Outlet Manager results into Video Training/Module Quiz/AI Practice, add staff filter + CPD year filter

Video Training was previously hidden inside the Module Quiz section
(same results table, only topic membership distinguished them) — now
its own section. All three quiz sections gain a staff-name filter
alongside their existing year/topic ones. CPD Hours section gains a
year dropdown (no 'All years' option — CPD is inherently
per-calendar-year) instead of being hardcoded to the current year."
```

---

### Task 3: Area Manager — split sections, respect outlet filter in CPD, add year filter per section

**Files:**
- Modify: `src/views/AreaManagerDashboard.vue`
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `splitByVideoTopic`, `videoHoursByTopic`, `hoursByStaff` (Task 1 + existing).

- [ ] **Step 1: Split results by outlet and source, replace the single filter set with three**

Change the import line:

```js
import { videoHoursByTopic, hoursByStaff } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
```

Change:

```js
const outletFilter = ref('ALL')
const yearFilter = ref('ALL')
const topicFilter = ref('ALL')

// yearFilter/topicFilter options are derived from outletScopedResults, so a
// value picked under one outlet can be meaningless under another (renders
// blank, list goes empty) — reset both back to ALL whenever the outlet
// scope changes.
watch(outletFilter, () => {
  yearFilter.value = 'ALL'
  topicFilter.value = 'ALL'
})
```

to:

```js
const outletFilter = ref('ALL')
const videoYear = ref('ALL')
const videoTopic = ref('ALL')
const standardYear = ref('ALL')
const standardTopic = ref('ALL')
const aiYear = ref('ALL')
const aiTopic = ref('ALL')
const cpdYear = ref(new Date().getFullYear())

// Every year/topic filter's option list is derived from outlet-scoped
// data, so a value picked under one outlet can be meaningless under
// another (renders blank, list goes empty) — reset all six back to ALL
// whenever the outlet scope changes. cpdYear is left alone — the current
// year is always a valid, always-present option regardless of outlet.
watch(outletFilter, () => {
  videoYear.value = 'ALL'
  videoTopic.value = 'ALL'
  standardYear.value = 'ALL'
  standardTopic.value = 'ALL'
  aiYear.value = 'ALL'
  aiTopic.value = 'ALL'
})
```

Change:

```js
const cpdSummary = computed(() => hoursByStaff(allResults.value, allAiResults.value, videoHoursByTopic(videoTrainings.value)))

const outletScopedResults = computed(() => outletFilter.value === 'ALL' ? allResults.value : allResults.value.filter((r) => r.Outlet === outletFilter.value))
const resultYears = computed(() => [...new Set(outletScopedResults.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const resultTopics = computed(() => [...new Set(outletScopedResults.value.map((r) => r.Topic))].sort())
const results = computed(() => outletScopedResults.value.filter((r) => {
  if (yearFilter.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== yearFilter.value) return false
  if (topicFilter.value !== 'ALL' && r.Topic !== topicFilter.value) return false
  return true
}))
```

to:

```js
const outletScopedResults = computed(() => outletFilter.value === 'ALL' ? allResults.value : allResults.value.filter((r) => r.Outlet === outletFilter.value))
const outletScopedAiResults = computed(() => outletFilter.value === 'ALL' ? allAiResults.value : allAiResults.value.filter((r) => r.Outlet === outletFilter.value))

// outletScopedResults carries every Video Training + Module Quiz result in
// scope (both write into the same results table, distinguished only by
// topic membership) — split once here, both sections below read from this.
const splitStandard = computed(() => splitByVideoTopic(outletScopedResults.value, videoHoursByTopic(videoTrainings.value)))
const videoTrainingResults = computed(() => splitStandard.value.video)
const moduleQuizResults = computed(() => splitStandard.value.moduleQuiz)

const videoYears = computed(() => [...new Set(videoTrainingResults.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const videoTopics = computed(() => [...new Set(videoTrainingResults.value.map((r) => r.Topic))].sort())
const filteredVideoResults = computed(() => videoTrainingResults.value.filter((r) => {
  if (videoYear.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== videoYear.value) return false
  if (videoTopic.value !== 'ALL' && r.Topic !== videoTopic.value) return false
  return true
}))

const standardYears = computed(() => [...new Set(moduleQuizResults.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const standardTopics = computed(() => [...new Set(moduleQuizResults.value.map((r) => r.Topic))].sort())
const filteredStandardResults = computed(() => moduleQuizResults.value.filter((r) => {
  if (standardYear.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== standardYear.value) return false
  if (standardTopic.value !== 'ALL' && r.Topic !== standardTopic.value) return false
  return true
}))

const aiYears = computed(() => [...new Set(outletScopedAiResults.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const aiTopics = computed(() => [...new Set(outletScopedAiResults.value.map((r) => r.Topic))].sort())
const filteredAiResults = computed(() => outletScopedAiResults.value.filter((r) => {
  if (aiYear.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== aiYear.value) return false
  if (aiTopic.value !== 'ALL' && r.Topic !== aiTopic.value) return false
  return true
}))

// CPD year dropdown always offers the current year even with zero data
// yet, plus any year real attempts exist for — no "ALL" option.
const cpdYears = computed(() => {
  const years = new Set([...outletScopedResults.value, ...outletScopedAiResults.value].map((r) => new Date(r.Timestamp).getFullYear()))
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
})
// Outlet filter now applies to the CPD summary too — previously this used
// the unfiltered allResults/allAiResults regardless of the outlet dropdown.
const cpdSummary = computed(() => hoursByStaff(outletScopedResults.value, outletScopedAiResults.value, videoHoursByTopic(videoTrainings.value), cpdYear.value))
```

- [ ] **Step 2: Update `wrongsFor` callers and the template**

`wrongsFor(h)` is unchanged (still takes one result row, matches by
AttemptID or the outlet+name+topic fallback) — it now gets called from the
Video Training and Module Quiz sections' own row lists instead of one
merged list.

In the template, change:

```html
        <div class="flex flex-wrap gap-2 mb-6">
          <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">{{ t('areaManagerDashboard.allOutletsInRegion') }}</option>
            <option v-for="o in regionOutlets" :key="o" :value="o">{{ o }}</option>
          </select>
          <select v-model="yearFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">{{ t('areaManagerDashboard.allYears') }}</option>
            <option v-for="y in resultYears" :key="y" :value="y">{{ y }}</option>
          </select>
          <select v-model="topicFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">{{ t('areaManagerDashboard.allTopics') }}</option>
            <option v-for="t2 in resultTopics" :key="t2" :value="t2">{{ t2 }}</option>
          </select>
        </div>

        <div v-if="results.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsFiltered') }}</div>
        <div v-else class="space-y-3">
          <details v-for="r in results" :key="`${r.Name}|${r.Outlet}|${r.Topic}|${r.Timestamp}`" class="bg-white rounded-xl2 shadow-sm">
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
            <div v-if="wrongsFor(r).length" class="px-5 pb-4 space-y-2">
              <div v-for="(w, j) in wrongsFor(r)" :key="j" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-coral">{{ t('areaManagerDashboard.questionPrefix', { text: w['Question Text'] }) }}</p>
                <p class="text-xs text-aqua font-semibold mt-1">{{ t('areaManagerDashboard.correctLabel', { text: w['Correct Answer'] }) }}</p>
              </div>
            </div>
          </details>
        </div>
```

to:

```html
        <div class="mb-6">
          <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">{{ t('areaManagerDashboard.allOutletsInRegion') }}</option>
            <option v-for="o in regionOutlets" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('areaManagerDashboard.videoTrainingHeading') }}</h2>
          <div v-if="videoTrainingResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="videoYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('areaManagerDashboard.allYears') }}</option>
                <option v-for="y in videoYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="videoTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('areaManagerDashboard.allTopics') }}</option>
                <option v-for="t2 in videoTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
            </div>
            <div v-if="filteredVideoResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsFiltered') }}</div>
            <div v-else class="space-y-3">
              <details v-for="r in filteredVideoResults" :key="`${r.Name}|${r.Outlet}|${r.Topic}|${r.Timestamp}`" class="bg-white rounded-xl2 shadow-sm">
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
                <div v-if="wrongsFor(r).length" class="px-5 pb-4 space-y-2">
                  <div v-for="(w, j) in wrongsFor(r)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('areaManagerDashboard.questionPrefix', { text: w['Question Text'] }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('areaManagerDashboard.correctLabel', { text: w['Correct Answer'] }) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('areaManagerDashboard.moduleQuizHeading') }}</h2>
          <div v-if="moduleQuizResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('areaManagerDashboard.allYears') }}</option>
                <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="standardTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('areaManagerDashboard.allTopics') }}</option>
                <option v-for="t2 in standardTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
            </div>
            <div v-if="filteredStandardResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsFiltered') }}</div>
            <div v-else class="space-y-3">
              <details v-for="r in filteredStandardResults" :key="`${r.Name}|${r.Outlet}|${r.Topic}|${r.Timestamp}`" class="bg-white rounded-xl2 shadow-sm">
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
                <div v-if="wrongsFor(r).length" class="px-5 pb-4 space-y-2">
                  <div v-for="(w, j) in wrongsFor(r)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('areaManagerDashboard.questionPrefix', { text: w['Question Text'] }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('areaManagerDashboard.correctLabel', { text: w['Correct Answer'] }) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('areaManagerDashboard.aiPracticeHeading') }}</h2>
          <div v-if="outletScopedAiResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('areaManagerDashboard.allYears') }}</option>
                <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="aiTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('areaManagerDashboard.allTopics') }}</option>
                <option v-for="t2 in aiTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
            </div>
            <div v-if="filteredAiResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsFiltered') }}</div>
            <div v-else class="space-y-3">
              <div v-for="r in filteredAiResults" :key="r.AttemptID" class="bg-white rounded-xl2 shadow-sm flex items-center gap-3 px-5 py-3">
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
              </div>
            </div>
          </template>
        </section>
```

Note: AI Practice rows render as a flat `div`, not `<details>` — this role's
`GET /scoped-data` branch was deliberately not extended to fetch
`ai_wrong_answers` (see the design spec's Non-goals), so there's nothing to
expand.

- [ ] **Step 3: Add the CPD year `<select>`**

Change:

```html
        <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('areaManagerDashboard.cpdHeading') }}</h2>
          <div class="bg-white rounded-xl2 divide-y divide-seafoam">
```

to:

```html
        <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('areaManagerDashboard.cpdHeading') }}</h2>
            <select v-model.number="cpdYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option v-for="y in cpdYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div class="bg-white rounded-xl2 divide-y divide-seafoam">
```

- [ ] **Step 4: Add the i18n keys**

In `src/i18n/locales/en.json`, inside `areaManagerDashboard`, change:

```json
    "allOutletsInRegion": "All outlets in region",
    "allYears": "All years",
    "allTopics": "All topics",
    "noResultsFiltered": "No results match this filter.",
    "questionPrefix": "Q: {text}",
    "correctLabel": "✓ Correct: {text}",
    "cpdHeading": "CPD Hours (this year)",
```

to:

```json
    "allOutletsInRegion": "All outlets in region",
    "allYears": "All years",
    "allTopics": "All topics",
    "noResultsFiltered": "No results match this filter.",
    "questionPrefix": "Q: {text}",
    "correctLabel": "✓ Correct: {text}",
    "videoTrainingHeading": "Video Training",
    "moduleQuizHeading": "Module Quiz",
    "aiPracticeHeading": "AI Practice",
    "cpdHeading": "CPD Hours",
```

In `src/i18n/locales/ms.json`, inside `areaManagerDashboard`, change:

```json
    "allOutletsInRegion": "Semua cawangan dalam wilayah",
    "allYears": "Semua tahun",
    "allTopics": "Semua topik",
    "noResultsFiltered": "Tiada keputusan sepadan dengan penapis ini.",
    "questionPrefix": "S: {text}",
    "correctLabel": "✓ Betul: {text}",
    "cpdHeading": "Jam CPD (tahun ini)",
```

to:

```json
    "allOutletsInRegion": "Semua cawangan dalam wilayah",
    "allYears": "Semua tahun",
    "allTopics": "Semua topik",
    "noResultsFiltered": "Tiada keputusan sepadan dengan penapis ini.",
    "questionPrefix": "S: {text}",
    "correctLabel": "✓ Betul: {text}",
    "videoTrainingHeading": "Latihan Video",
    "moduleQuizHeading": "Modul Kuiz",
    "aiPracticeHeading": "Amalan AI",
    "cpdHeading": "Jam CPD",
```

(Confirm existing MS values first, same caveat as Task 2 Step 5 — don't
overwrite what's already there, only add the new keys.)

- [ ] **Step 5: Verify build is clean**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Verify EN/MS key parity**

Same script as Task 2 Step 7. Expected: both arrays empty.

- [ ] **Step 7: Manual verification — live browser**

Insert temporary test data spanning 2 outlets in the same region (to
exercise the outlet dropdown), including a Video Training result, a Module
Quiz result, and an AI Practice result. Log in via a minted `area_manager`
JWT, navigate to `/area-manager`, confirm: three sections render
independently with their own year/topic filters; the AI Practice section
now shows real rows (was previously never rendered at all, only the
`allAiResults` fetch existed); switching the outlet dropdown resets all six
year/topic filters back to ALL and re-scopes every section including CPD;
picking a past year with no data on the CPD dropdown drops a staff member
whose only test row is in the current year out of the list entirely (proof
`cpdYear` is actually wired into `hoursByStaff`'s year param). Clean up
test rows afterward.

- [ ] **Step 8: Commit**

```bash
cd C:\Users\Hafiz\projects\lautan-academy
git add lautan-academy-frontend/src/views/AreaManagerDashboard.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Split Area Manager results into Video Training/Module Quiz/AI Practice, filter CPD by outlet+year

AI Practice data has been fetched since the CPD Hours backend fix
but was never rendered — now its own section (no wrong-answer detail,
this role's scoped-data branch doesn't fetch ai_wrong_answers). Video
Training splits out of the old combined section. CPD Hours summary
now respects the outlet dropdown (previously ignored it entirely) and
gets its own year dropdown instead of being hardcoded to the current
year."
```

---

### Task 4: Supervisor Staff Comparison — split leaderboard, add year/topic per section, CPD year filter

**Files:**
- Modify: `src/views/SupervisorStaffComparisonView.vue`
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `splitByVideoTopic`, `videoHoursByTopic`, `hoursByStaff` (Task 1 + existing).
- Produces: local `buildLeaderboard(list, year, topic, sort)` helper — not exported, used three times within this file only.

- [ ] **Step 1: Add the shared `outletScoped`/`buildLeaderboard` helpers and split `results` by source**

Change the import line:

```js
import { videoHoursByTopic, hoursByStaff } from '../composables/useCpdHours'
```

to:

```js
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
```

Change:

```js
const cpdResults = ref([])
const cpdAiResults = ref([])
const videoTrainings = ref([])
const CPD_TARGET_HOURS = 120
```

to:

```js
const cpdResults = ref([])
const cpdAiResults = ref([])
const videoTrainings = ref([])
const CPD_TARGET_HOURS = 120
const videoYear = ref('ALL')
const videoTopic = ref('ALL')
const videoSort = ref('avg')
const standardYear = ref('ALL')
const standardTopic = ref('ALL')
const standardSort = ref('avg')
const aiYear = ref('ALL')
const aiTopic = ref('ALL')
const aiSort = ref('avg')
const cpdYear = ref(new Date().getFullYear())
```

Change:

```js
const outlets = computed(() => {
  if (regionFilter.value !== 'ALL') return outletsForArea(regionFilter.value)
  return [...new Set([...results.value, ...aiResults.value].map(r => r.Outlet))].filter(Boolean).sort()
})

const rows = computed(() => {
  const all = [...results.value, ...aiResults.value]
  let filtered = all
  if (regionFilter.value !== 'ALL') {
    const regionOutlets = new Set(outletsForArea(regionFilter.value))
    filtered = filtered.filter(r => regionOutlets.has(r.Outlet))
  }
  if (outletFilter.value !== 'ALL') filtered = filtered.filter(r => r.Outlet === outletFilter.value)
  const byStaff = new Map()
  for (const r of filtered) {
    const key = `${r.Name}|${r.Outlet}`
    if (!byStaff.has(key)) byStaff.set(key, { name: r.Name, outlet: r.Outlet, attempts: 0, sum: 0 })
    const entry = byStaff.get(key)
    entry.attempts += 1
    entry.sum += parseInt(r.Percentage) || 0
  }
  const list = [...byStaff.values()].map(e => ({ ...e, avg: Math.round(e.sum / e.attempts) }))
  if (sortBy.value === 'avg') list.sort((a, b) => b.avg - a.avg)
  else if (sortBy.value === 'attempts') list.sort((a, b) => b.attempts - a.attempts)
  else list.sort((a, b) => a.name.localeCompare(b.name))
  return list
})
```

to:

```js
const outlets = computed(() => {
  if (regionFilter.value !== 'ALL') return outletsForArea(regionFilter.value)
  return [...new Set([...results.value, ...aiResults.value].map(r => r.Outlet))].filter(Boolean).sort()
})

// Region+outlet scoping shared by every leaderboard below — pulled out
// once instead of repeating the same two `if` blocks three times.
function outletScoped(list) {
  let filtered = list
  if (regionFilter.value !== 'ALL') {
    const regionOutlets = new Set(outletsForArea(regionFilter.value))
    filtered = filtered.filter(r => regionOutlets.has(r.Outlet))
  }
  if (outletFilter.value !== 'ALL') filtered = filtered.filter(r => r.Outlet === outletFilter.value)
  return filtered
}

// Same aggregate-by-staff math the old single `rows` computed used, now
// parameterized so Video Training/Module Quiz/AI Practice can each have
// their own year/topic/sort state without three copies of this logic.
function buildLeaderboard(list, year, topic, sort) {
  const filtered = outletScoped(list).filter(r => {
    if (year !== 'ALL' && new Date(r.Timestamp).getFullYear() !== year) return false
    if (topic !== 'ALL' && r.Topic !== topic) return false
    return true
  })
  const byStaff = new Map()
  for (const r of filtered) {
    const key = `${r.Name}|${r.Outlet}`
    if (!byStaff.has(key)) byStaff.set(key, { name: r.Name, outlet: r.Outlet, attempts: 0, sum: 0 })
    const entry = byStaff.get(key)
    entry.attempts += 1
    entry.sum += parseInt(r.Percentage) || 0
  }
  const list2 = [...byStaff.values()].map(e => ({ ...e, avg: Math.round(e.sum / e.attempts) }))
  if (sort === 'avg') list2.sort((a, b) => b.avg - a.avg)
  else if (sort === 'attempts') list2.sort((a, b) => b.attempts - a.attempts)
  else list2.sort((a, b) => a.name.localeCompare(b.name))
  return list2
}

// results carries every Video Training + Module Quiz row in the current
// windowMonths fetch (both write into the same results table, distinguished
// only by topic membership) — split once here, both leaderboards below
// read from this.
const splitResults = computed(() => splitByVideoTopic(results.value, videoHoursByTopic(videoTrainings.value)))

const videoYears = computed(() => [...new Set(outletScoped(splitResults.value.video).map(r => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const videoTopics = computed(() => [...new Set(outletScoped(splitResults.value.video).map(r => r.Topic))].sort())
const videoRows = computed(() => buildLeaderboard(splitResults.value.video, videoYear.value, videoTopic.value, videoSort.value))

const standardYears = computed(() => [...new Set(outletScoped(splitResults.value.moduleQuiz).map(r => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const standardTopics = computed(() => [...new Set(outletScoped(splitResults.value.moduleQuiz).map(r => r.Topic))].sort())
const standardRows = computed(() => buildLeaderboard(splitResults.value.moduleQuiz, standardYear.value, standardTopic.value, standardSort.value))

const aiYears = computed(() => [...new Set(outletScoped(aiResults.value).map(r => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const aiTopics = computed(() => [...new Set(outletScoped(aiResults.value).map(r => r.Topic))].sort())
const aiRows = computed(() => buildLeaderboard(aiResults.value, aiYear.value, aiTopic.value, aiSort.value))
```

- [ ] **Step 2: Wire the CPD summary to the year filter and to outlet/region scoping**

Change:

```js
const cpdSummary = computed(() => hoursByStaff(cpdResults.value, cpdAiResults.value, videoHoursByTopic(videoTrainings.value)))
```

to:

```js
// CPD year dropdown always offers the current year even with zero data
// yet, plus any year real attempts exist for — no "ALL" option.
const cpdYears = computed(() => {
  const years = new Set([...cpdResults.value, ...cpdAiResults.value].map((r) => new Date(r.Timestamp).getFullYear()))
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
})
// Region/outlet filters now apply to the CPD summary too — previously this
// ignored them entirely, since cpdResults/cpdAiResults are deliberately
// unscoped by windowMonths (see the existing comment above the onMounted
// fetch) but were never outlet/region-scoped either.
const cpdSummary = computed(() => hoursByStaff(outletScoped(cpdResults.value), outletScoped(cpdAiResults.value), videoHoursByTopic(videoTrainings.value), cpdYear.value))
```

- [ ] **Step 3: Replace the template's single filter row + single list with three sections, add CPD year select**

Change:

```html
      <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
        <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('supervisorStaffComparisonView.cpdHeading') }}</h2>
        <div class="bg-white rounded-xl2 divide-y divide-seafoam">
```

to:

```html
      <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 class="font-display text-base font-semibold text-ink">{{ t('supervisorStaffComparisonView.cpdHeading') }}</h2>
          <select v-model.number="cpdYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option v-for="y in cpdYears" :key="y" :value="y">{{ y }}</option>
          </select>
        </div>
        <div class="bg-white rounded-xl2 divide-y divide-seafoam">
```

Change:

```html
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <select v-model.number="windowMonths" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option :value="3">{{ t('supervisorStaffComparisonView.last3Months') }}</option>
          <option :value="6">{{ t('supervisorStaffComparisonView.last6Months') }}</option>
          <option :value="12">{{ t('supervisorStaffComparisonView.last12Months') }}</option>
          <option :value="0">{{ t('supervisorStaffComparisonView.allTime') }}</option>
        </select>
        <select v-model="regionFilter" @change="onRegionChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorStaffComparisonView.allRegions') }}</option>
          <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
        </select>
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorStaffComparisonView.allOutlets') }}</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
        <select v-model="sortBy" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="avg">{{ t('supervisorStaffComparisonView.sortAvg') }}</option>
          <option value="attempts">{{ t('supervisorStaffComparisonView.sortAttempts') }}</option>
          <option value="name">{{ t('supervisorStaffComparisonView.sortName') }}</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">{{ t('supervisorStaffComparisonView.loading') }}</div>
      <div v-else-if="rows.length === 0" class="text-slate text-sm">{{ t('supervisorStaffComparisonView.noActivity') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <div v-for="(r, i) in rows" :key="i" class="flex items-center justify-between px-5 py-3">
          <div>
            <p class="text-sm font-medium text-ink">{{ r.name }}</p>
            <p class="text-xs text-slate">{{ r.outlet }} · {{ t('supervisorStaffComparisonView.attemptsCount', r.attempts) }}</p>
          </div>
          <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
        </div>
      </div>
```

to:

```html
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <select v-model.number="windowMonths" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option :value="3">{{ t('supervisorStaffComparisonView.last3Months') }}</option>
          <option :value="6">{{ t('supervisorStaffComparisonView.last6Months') }}</option>
          <option :value="12">{{ t('supervisorStaffComparisonView.last12Months') }}</option>
          <option :value="0">{{ t('supervisorStaffComparisonView.allTime') }}</option>
        </select>
        <select v-model="regionFilter" @change="onRegionChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorStaffComparisonView.allRegions') }}</option>
          <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
        </select>
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorStaffComparisonView.allOutlets') }}</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">{{ t('supervisorStaffComparisonView.loading') }}</div>
      <template v-else>
        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('supervisorStaffComparisonView.videoTrainingHeading') }}</h2>
          <div class="flex flex-wrap gap-2 mb-3">
            <select v-model="videoYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="ALL">{{ t('supervisorStaffComparisonView.allYears') }}</option>
              <option v-for="y in videoYears" :key="y" :value="y">{{ y }}</option>
            </select>
            <select v-model="videoTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="ALL">{{ t('supervisorStaffComparisonView.allTopics') }}</option>
              <option v-for="t2 in videoTopics" :key="t2" :value="t2">{{ t2 }}</option>
            </select>
            <select v-model="videoSort" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="avg">{{ t('supervisorStaffComparisonView.sortAvg') }}</option>
              <option value="attempts">{{ t('supervisorStaffComparisonView.sortAttempts') }}</option>
              <option value="name">{{ t('supervisorStaffComparisonView.sortName') }}</option>
            </select>
          </div>
          <div v-if="videoRows.length === 0" class="text-slate text-sm">{{ t('supervisorStaffComparisonView.noActivity') }}</div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="(r, i) in videoRows" :key="i" class="flex items-center justify-between px-5 py-3">
              <div>
                <p class="text-sm font-medium text-ink">{{ r.name }}</p>
                <p class="text-xs text-slate">{{ r.outlet }} · {{ t('supervisorStaffComparisonView.attemptsCount', r.attempts) }}</p>
              </div>
              <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
            </div>
          </div>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('supervisorStaffComparisonView.moduleQuizHeading') }}</h2>
          <div class="flex flex-wrap gap-2 mb-3">
            <select v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="ALL">{{ t('supervisorStaffComparisonView.allYears') }}</option>
              <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
            </select>
            <select v-model="standardTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="ALL">{{ t('supervisorStaffComparisonView.allTopics') }}</option>
              <option v-for="t2 in standardTopics" :key="t2" :value="t2">{{ t2 }}</option>
            </select>
            <select v-model="standardSort" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="avg">{{ t('supervisorStaffComparisonView.sortAvg') }}</option>
              <option value="attempts">{{ t('supervisorStaffComparisonView.sortAttempts') }}</option>
              <option value="name">{{ t('supervisorStaffComparisonView.sortName') }}</option>
            </select>
          </div>
          <div v-if="standardRows.length === 0" class="text-slate text-sm">{{ t('supervisorStaffComparisonView.noActivity') }}</div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="(r, i) in standardRows" :key="i" class="flex items-center justify-between px-5 py-3">
              <div>
                <p class="text-sm font-medium text-ink">{{ r.name }}</p>
                <p class="text-xs text-slate">{{ r.outlet }} · {{ t('supervisorStaffComparisonView.attemptsCount', r.attempts) }}</p>
              </div>
              <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
            </div>
          </div>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('supervisorStaffComparisonView.aiPracticeHeading') }}</h2>
          <div class="flex flex-wrap gap-2 mb-3">
            <select v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="ALL">{{ t('supervisorStaffComparisonView.allYears') }}</option>
              <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
            </select>
            <select v-model="aiTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="ALL">{{ t('supervisorStaffComparisonView.allTopics') }}</option>
              <option v-for="t2 in aiTopics" :key="t2" :value="t2">{{ t2 }}</option>
            </select>
            <select v-model="aiSort" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
              <option value="avg">{{ t('supervisorStaffComparisonView.sortAvg') }}</option>
              <option value="attempts">{{ t('supervisorStaffComparisonView.sortAttempts') }}</option>
              <option value="name">{{ t('supervisorStaffComparisonView.sortName') }}</option>
            </select>
          </div>
          <div v-if="aiRows.length === 0" class="text-slate text-sm">{{ t('supervisorStaffComparisonView.noActivity') }}</div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="(r, i) in aiRows" :key="i" class="flex items-center justify-between px-5 py-3">
              <div>
                <p class="text-sm font-medium text-ink">{{ r.name }}</p>
                <p class="text-xs text-slate">{{ r.outlet }} · {{ t('supervisorStaffComparisonView.attemptsCount', r.attempts) }}</p>
              </div>
              <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
            </div>
          </div>
        </section>
      </template>
```

- [ ] **Step 4: Add the i18n keys**

In `src/i18n/locales/en.json`, inside `supervisorStaffComparisonView`,
change:

```json
    "sortAvg": "Sort: Avg score",
    "sortAttempts": "Sort: Attempts",
    "sortName": "Sort: Name",
    "loading": "Loading...",
    "noActivity": "No activity in this window.",
    "attemptsCount": "{count} attempt | {count} attempts",
    "cpdHeading": "CPD Hours (this year)",
```

to:

```json
    "sortAvg": "Sort: Avg score",
    "sortAttempts": "Sort: Attempts",
    "sortName": "Sort: Name",
    "loading": "Loading...",
    "noActivity": "No activity in this window.",
    "attemptsCount": "{count} attempt | {count} attempts",
    "allYears": "All years",
    "allTopics": "All topics",
    "videoTrainingHeading": "Video Training",
    "moduleQuizHeading": "Module Quiz",
    "aiPracticeHeading": "AI Practice",
    "cpdHeading": "CPD Hours",
```

In `src/i18n/locales/ms.json`, inside `supervisorStaffComparisonView`,
change:

```json
    "sortAvg": "Susun: Skor purata",
    "sortAttempts": "Susun: Percubaan",
    "sortName": "Susun: Nama",
    "loading": "Memuatkan...",
    "noActivity": "Tiada aktiviti dalam tempoh ini.",
    "attemptsCount": "{count} percubaan",
    "cpdHeading": "Jam CPD (tahun ini)",
```

to:

```json
    "sortAvg": "Susun: Skor purata",
    "sortAttempts": "Susun: Percubaan",
    "sortName": "Susun: Nama",
    "loading": "Memuatkan...",
    "noActivity": "Tiada aktiviti dalam tempoh ini.",
    "attemptsCount": "{count} percubaan",
    "allYears": "Semua tahun",
    "allTopics": "Semua topik",
    "videoTrainingHeading": "Latihan Video",
    "moduleQuizHeading": "Modul Kuiz",
    "aiPracticeHeading": "Amalan AI",
    "cpdHeading": "Jam CPD",
```

(Confirm existing MS values first, same caveat as prior tasks.)

- [ ] **Step 5: Verify build is clean**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Verify EN/MS key parity**

Same script as Task 2 Step 7. Expected: both arrays empty.

- [ ] **Step 7: Manual verification — live browser**

Insert temporary test data covering all three sources for one staff member.
Log in via a minted `supervisor` JWT, navigate to `/supervisor/staff-comparison`,
confirm: three independent leaderboards render, each with its own
year/topic/sort; switching `windowMonths` to a narrower window still shows
that staff member in whichever leaderboards have data inside the narrower
window (and drops them from ones that don't); the CPD section's year
dropdown still shows the full total regardless of `windowMonths` (proof the
CPD fetch is genuinely decoupled, same check the CPD Hours Tracking plan
already verified — this task adds outlet/region scoping to it, verify
switching the outlet dropdown does change the CPD number, unlike before).
Clean up test rows afterward.

- [ ] **Step 8: Commit**

```bash
cd C:\Users\Hafiz\projects\lautan-academy
git add lautan-academy-frontend/src/views/SupervisorStaffComparisonView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Split Supervisor leaderboard into Video Training/Module Quiz/AI Practice, add per-section year/topic, scope CPD by outlet+region+year

Three independent leaderboards replace the old single combined one,
each with its own year/topic/sort state built on a new shared
buildLeaderboard() helper (same aggregate-by-staff math the old
single computed used, parameterized instead of tripled). CPD Hours
summary now respects the outlet/region filters (previously ignored
them) and gets its own year dropdown instead of being hardcoded to
the current year."
```

---

### Task 5: Staff Quiz History — split sections, add year filters, new CPD section

**Files:**
- Modify: `src/views/QuizHistoryView.vue`
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `splitByVideoTopic`, `videoHoursByTopic`, `hoursByStaff` (Task 1 + existing). `auth.impersonating` (`store/auth.js`, `auth` already imported/used in this view).

- [ ] **Step 1: Fetch video trainings, split history, add year refs and CPD state**

Change the import lines:

```js
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import ProgressRing from '../components/ProgressRing.vue'
```

to:

```js
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
import ProgressRing from '../components/ProgressRing.vue'
```

Change:

```js
const { t } = useI18n()
const standardHistory = ref([])
const aiHistory = ref([])
const wrongAnswers = ref([])
const aiWrongAnswers = ref([])
const reports = ref([])
const loading = ref(true)
const auth = useAuthStore()

const reportYear = ref('ALL')
const reportTopic = ref('ALL')

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false
})
```

to:

```js
const { t } = useI18n()
const standardHistory = ref([])
const aiHistory = ref([])
const wrongAnswers = ref([])
const aiWrongAnswers = ref([])
const reports = ref([])
const videoTrainings = ref([])
const loading = ref(true)
const auth = useAuthStore()
const CPD_TARGET_HOURS = 120

const reportYear = ref('ALL')
const reportTopic = ref('ALL')
const videoYear = ref('ALL')
const standardYear = ref('ALL')
const aiYear = ref('ALL')
const cpdYear = ref(new Date().getFullYear())

onMounted(async () => {
  try {
    const [data, videos] = await Promise.all([api.getScopedData(), api.getVideoTrainings()])
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false
})

// standardHistory carries every Video Training + Module Quiz result for
// this staff member (both write into the same results table, distinguished
// only by topic membership) — split once here, both sections below read
// from this.
const splitStandard = computed(() => splitByVideoTopic(standardHistory.value, videoHoursByTopic(videoTrainings.value)))
const videoTrainingHistory = computed(() => splitStandard.value.video)
const moduleQuizHistory = computed(() => splitStandard.value.moduleQuiz)

const filteredVideoHistory = computed(() => videoYear.value === 'ALL' ? videoTrainingHistory.value : videoTrainingHistory.value.filter((h) => new Date(h.Timestamp).getFullYear() === videoYear.value))
const videoYears = computed(() => [...new Set(videoTrainingHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))

const filteredStandardHistory = computed(() => standardYear.value === 'ALL' ? moduleQuizHistory.value : moduleQuizHistory.value.filter((h) => new Date(h.Timestamp).getFullYear() === standardYear.value))
const standardYears = computed(() => [...new Set(moduleQuizHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))

const filteredAiHistory = computed(() => aiYear.value === 'ALL' ? aiHistory.value : aiHistory.value.filter((h) => new Date(h.Timestamp).getFullYear() === aiYear.value))
const aiYears = computed(() => [...new Set(aiHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))

// CPD year dropdown always offers the current year even with zero data
// yet, plus any year real attempts exist for — no "ALL" option.
const cpdYears = computed(() => {
  const years = new Set([...standardHistory.value, ...aiHistory.value].map((h) => new Date(h.Timestamp).getFullYear()))
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
})
// Single-staff variant of the manager views' cpdSummary — hoursByStaff()
// still returns an array (one entry, this staff member), read [0].
const cpdHoursThisYear = computed(() => hoursByStaff(standardHistory.value, aiHistory.value, videoHoursByTopic(videoTrainings.value), cpdYear.value)[0]?.hours || 0)
```

- [ ] **Step 2: Add the CPD Hours section, split the Module Quiz section, add year dropdowns**

Change:

```html
      <template v-else>
        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('quizHistoryView.moduleQuizHeading') }}</h2>
          <div v-if="standardHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noModuleHistory') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="(h, i) in standardHistory" :key="i" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: w['Question Text'] }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('quizHistoryView.aiPracticeHeading') }}</h2>
          <div v-if="aiHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noAiHistory') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="h in aiHistory" :key="h.AttemptID" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForAi(h.AttemptID).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForAi(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: w['Question Text'] }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>
```

to:

```html
      <template v-else>
        <section v-if="auth.impersonating" class="mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.cpdHeading') }}</h2>
            <select v-model.number="cpdYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option v-for="y in cpdYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div class="bg-white rounded-xl2 px-5 py-4 flex items-center justify-between">
            <p class="text-sm text-slate">{{ t('quizHistoryView.cpdHeading') }}</p>
            <span class="text-sm font-display font-semibold" :class="cpdHoursThisYear >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
              {{ t('quizHistoryView.cpdHoursOfTarget', { hours: cpdHoursThisYear, target: CPD_TARGET_HOURS }) }}
            </span>
          </div>
        </section>
        <section v-else class="mb-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('quizHistoryView.cpdHeading') }}</h2>
          <div class="bg-white rounded-xl2 px-5 py-4">
            <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('quizHistoryView.cpdComingSoon') }}</p>
          </div>
        </section>

        <section>
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.videoTrainingHeading') }}</h2>
            <select v-if="videoTrainingHistory.length" v-model="videoYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option value="ALL">{{ t('quizHistoryView.allYears') }}</option>
              <option v-for="y in videoYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="videoTrainingHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noVideoHistory') }}</p>
          </div>
          <div v-else-if="filteredVideoHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noHistoryFiltered') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="(h, i) in filteredVideoHistory" :key="i" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: w['Question Text'] }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>

        <section class="mt-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.moduleQuizHeading') }}</h2>
            <select v-if="moduleQuizHistory.length" v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option value="ALL">{{ t('quizHistoryView.allYears') }}</option>
              <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="moduleQuizHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noModuleHistory') }}</p>
          </div>
          <div v-else-if="filteredStandardHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noHistoryFiltered') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="(h, i) in filteredStandardHistory" :key="i" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: w['Question Text'] }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>

        <section class="mt-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.aiPracticeHeading') }}</h2>
            <select v-if="aiHistory.length" v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option value="ALL">{{ t('quizHistoryView.allYears') }}</option>
              <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="aiHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noAiHistory') }}</p>
          </div>
          <div v-else-if="filteredAiHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noHistoryFiltered') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="h in filteredAiHistory" :key="h.AttemptID" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForAi(h.AttemptID).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForAi(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: w['Question Text'] }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: w['Correct Answer'] }) }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>
```

Note: `videoYear`/`standardYear`/`aiYear` use plain `v-model` (not
`.number`) because their value can also be the string `'ALL'` — same
convention `OutletManagerResultsView.vue`'s existing `standardYear`/`aiYear`
selects already use. Vue's `<select>` v-model binds against each
`<option>`'s actual bound `:value` (not the stringified DOM attribute), so
`:value="y"` where `y` is a number still round-trips as a real number even
under plain `v-model` — confirmed by the existing OM code already relying
on exactly this. Only `cpdYear` uses `.number`, since it never holds
`'ALL'`.

- [ ] **Step 3: Add the i18n keys**

In `src/i18n/locales/en.json`, inside `quizHistoryView`, change:

```json
    "moduleQuizHeading": "Module Quiz",
    "noModuleHistory": "Nothing here yet — take a module quiz from the sidebar.",
    "questionPrefix": "Q: {text}",
    "correctLabel": "✓ Correct: {text}",
    "aiPracticeHeading": "AI Practice",
    "noAiHistory": "Nothing here yet — your first practice attempt will show up after you join a code.",
```

to:

```json
    "cpdHeading": "CPD Hours",
    "cpdHoursOfTarget": "{hours} / {target} hrs",
    "cpdComingSoon": "Coming soon",
    "videoTrainingHeading": "Video Training",
    "noVideoHistory": "Nothing here yet — watch a training video from the sidebar.",
    "moduleQuizHeading": "Module Quiz",
    "noModuleHistory": "Nothing here yet — take a module quiz from the sidebar.",
    "noHistoryFiltered": "No attempts match this filter.",
    "questionPrefix": "Q: {text}",
    "correctLabel": "✓ Correct: {text}",
    "aiPracticeHeading": "AI Practice",
    "noAiHistory": "Nothing here yet — your first practice attempt will show up after you join a code.",
```

In `src/i18n/locales/ms.json`, inside `quizHistoryView`, change:

```json
    "moduleQuizHeading": "Modul Kuiz",
    "noModuleHistory": "Belum ada apa-apa di sini — ambil kuiz modul dari sidebar.",
    "questionPrefix": "S: {text}",
    "correctLabel": "✓ Betul: {text}",
    "aiPracticeHeading": "Latihan AI",
    "noAiHistory": "Belum ada apa-apa di sini — percubaan latihan pertama anda akan dipaparkan selepas anda menyertai kod.",
```

to:

```json
    "cpdHeading": "Jam CPD",
    "cpdHoursOfTarget": "{hours} / {target} jam",
    "cpdComingSoon": "Akan datang",
    "videoTrainingHeading": "Latihan Video",
    "noVideoHistory": "Belum ada apa-apa di sini — tonton video latihan dari sidebar.",
    "moduleQuizHeading": "Modul Kuiz",
    "noModuleHistory": "Belum ada apa-apa di sini — ambil kuiz modul dari sidebar.",
    "noHistoryFiltered": "Tiada percubaan sepadan dengan penapis ini.",
    "questionPrefix": "S: {text}",
    "correctLabel": "✓ Betul: {text}",
    "aiPracticeHeading": "Latihan AI",
    "noAiHistory": "Belum ada apa-apa di sini — percubaan latihan pertama anda akan dipaparkan selepas anda menyertai kod.",
```

(Confirm existing MS values first, same caveat as prior tasks.)

- [ ] **Step 4: Verify build is clean**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Verify EN/MS key parity**

Same script as Task 2 Step 7. Expected: both arrays empty.

- [ ] **Step 6: Manual verification — live browser**

Insert temporary test data: a Video Training result, a Module Quiz result,
an AI Practice result, all for one staff member/outlet. Log in **directly**
as that staff member (real login, no PIN needed — matches this codebase's
existing staff login flow), navigate to Quiz History, confirm: three
sections render (Video Training / Module Quiz / AI Practice) each with
their own year dropdown (no topic filter); the CPD section shows "Coming
soon". Then switch to the Master-impersonated session for the same staff
member, confirm the CPD section now shows the real "{hours} / 120 hrs"
figure with a year dropdown, and that it matches the number already shown
on the Dashboard for the same staff member (same underlying computation,
different section). Clean up test rows afterward.

- [ ] **Step 7: Commit**

```bash
cd C:\Users\Hafiz\projects\lautan-academy
git add lautan-academy-frontend/src/views/QuizHistoryView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Split staff Quiz History into Video Training/Module Quiz/AI Practice, add year filters, add CPD Hours section

Video Training was previously hidden inside the Module Quiz section.
All three sections gain a year-only filter (no topic — a single
staff member's own topic list per source is short enough not to need
one). New CPD Hours section (Dashboard already had one, this view
didn't) — same Coming-Soon/impersonation gate, own year dropdown."
```

---

## Self-review notes (for the plan author, not a task)

- **Spec coverage:** Composable addition (Task 1) ✓. Outlet Manager 3-way
  split + staff filter + CPD year (Task 2) ✓. Area Manager 3-way split
  (including previously-unrendered AI Practice) + CPD outlet+year scoping
  (Task 3) ✓. Supervisor 3-way leaderboard split + CPD outlet+region+year
  scoping, windowMonths kept alongside the new year filter (Task 4) ✓.
  Staff Quiz History 3-way split + year-only filters + new CPD section
  (Task 5) ✓. CPD headings de-"(this year)"-ed everywhere they exist
  ✓. No topic filter on any CPD section ✓. No staff-name filter outside
  Outlet Manager ✓. No `ai_wrong_answers` fetch added for Area Manager
  (explicit non-goal, documented inline in Task 3) ✓.
- **Placeholder scan:** none — every step has literal before/after code.
  The two "confirm existing MS values first" notes (Tasks 2, 3, 4, 5) are
  real instructions to the implementer (this plan's own EN text was
  authored fresh, not copy-verified against the live MS file at
  plan-writing time), not TBDs on new content — every new key's value is
  written out in full.
- **Type/name consistency:** `splitByVideoTopic(results, hoursByTopic)` →
  `{ video, moduleQuiz }` (Task 1) is called with identical argument order
  and destructured identically in Tasks 2, 3, 4, 5. `hoursByStaff(results,
  aiResults, hoursByTopic, year)`'s new 4th argument is passed a `cpdYear`
  ref's `.value` consistently across all four CPD call sites. `outletScoped`
  and `buildLeaderboard` (Task 4) are local to
  `SupervisorStaffComparisonView.vue` only — not exported, not reused
  elsewhere, matching the spec's explicit "inline, not a new composable"
  call. Caught and fixed during this self-review: Task 5's first draft used
  `v-model.number` on `videoYear`/`standardYear`/`aiYear` (which can hold
  the string `'ALL'`) — corrected to plain `v-model`, matching
  `OutletManagerResultsView.vue`'s existing convention for the same kind of
  filter, with an inline note in Task 5 Step 2 flagging the fix so the
  implementer doesn't reintroduce it from the shown diff text.
