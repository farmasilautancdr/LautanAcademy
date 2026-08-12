<script setup>
// Split out — File a Report/Filed Reports moved to AreaManagerReviewsView.vue
// since the sidebar's "Reviews" item needs its own destination. This page
// keeps just the raw Standard Quiz results + wrong-answers browsing, which
// the sidebar's "Staff Results" item points to.
//
// auth.manager.outlet is the area id ("R1 - AMIRUL") for this role, not one
// outlet — scoped-data now returns every outlet in the region, so each
// result needs its own outlet shown rather than assuming a single one.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import { videoHoursByTopic, hoursByStaff } from '../composables/useCpdHours'

const auth = useAuthStore()
const areaLabel = auth.manager?.outlet
const regionOutlets = auth.manager?.outlets || []
const managerLabel = auth.manager?.label || 'Area Manager'
const { t } = useI18n()

const allResults = ref([])
const wrongAnswers = ref([])
const allAiResults = ref([])
const videoTrainings = ref([])
const loading = ref(true)
const CPD_TARGET_HOURS = 120
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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

onMounted(async () => {
  try {
    const [scoped, videos] = await Promise.all([api.getScopedData(), api.getVideoTrainings()])
    allResults.value = (scoped.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = scoped.wrongAnswers || []
    // Real data as of Task 4's backend fix — this branch used to hardcode
    // aiResults to [].
    allAiResults.value = scoped.aiResults || []
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

// allResults/allAiResults cover every outlet in the region (unlike Outlet
// Manager's single-outlet scope) — hoursByStaff()'s `${Name}|${Outlet}`
// grouping key already keeps two same-named staff at different outlets
// separate.
const cpdSummary = computed(() => hoursByStaff(allResults.value, allAiResults.value, videoHoursByTopic(videoTrainings.value)))

const outletScopedResults = computed(() => outletFilter.value === 'ALL' ? allResults.value : allResults.value.filter((r) => r.Outlet === outletFilter.value))
const resultYears = computed(() => [...new Set(outletScopedResults.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const resultTopics = computed(() => [...new Set(outletScopedResults.value.map((r) => r.Topic))].sort())
const results = computed(() => outletScopedResults.value.filter((r) => {
  if (yearFilter.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== yearFilter.value) return false
  if (topicFilter.value !== 'ALL' && r.Topic !== topicFilter.value) return false
  return true
}))

// Matches by AttemptID, same approach as QuizHistoryView.vue and
// OutletManagerResultsView.vue: rows saved after the attempt_id migration
// (see backend migrate-add-attempt-id.js) get exact per-attempt matching.
// Older rows predating it have no AttemptID on either side — for those
// only, fall back to the old name+outlet+topic match (staff names aren't
// unique across a region's outlets, so the fallback must check outlet too).
function wrongsFor(h) {
  if (h.AttemptID) return wrongAnswers.value.filter((w) => w.AttemptID === h.AttemptID)
  return wrongAnswers.value.filter((w) => !w.AttemptID && w['Staff Name'] === h.Name && w.Outlet === h.Outlet && w.Topic === h.Topic)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ managerLabel }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('areaManagerDashboard.title', { area: areaLabel }) }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('areaManagerDashboard.loading') }}</div>
      <div v-else-if="allResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsYet') }}</div>
      <template v-else>
        <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('areaManagerDashboard.cpdHeading') }}</h2>
          <div class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="s in cpdSummary" :key="`${s.name}|${s.outlet}`" class="px-5 py-3 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
                <p class="text-xs text-slate">{{ s.outlet }}</p>
              </div>
              <span class="text-sm font-display font-semibold shrink-0" :class="s.hours >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
                {{ t('areaManagerDashboard.cpdHoursOfTarget', { hours: s.hours, target: CPD_TARGET_HOURS }) }}
              </span>
            </div>
          </div>
        </section>
        <section v-else-if="!auth.impersonating" class="mb-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('areaManagerDashboard.cpdHeading') }}</h2>
          <div class="bg-white rounded-xl2 px-5 py-4">
            <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('areaManagerDashboard.cpdComingSoon') }}</p>
          </div>
        </section>

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
      </template>
    </main>
  </div>
</template>
