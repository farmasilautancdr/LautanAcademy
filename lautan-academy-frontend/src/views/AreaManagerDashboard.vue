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
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic } from '../composables/useCpdHours'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'
import PharmacistComplianceMatrix from '../components/PharmacistComplianceMatrix.vue'

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
  const years = new Set([...allResults.value, ...allAiResults.value].map((r) => new Date(r.Timestamp).getFullYear()))
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
})
// Outlet filter now applies to the CPD summary too — previously this used
// the unfiltered allResults/allAiResults regardless of the outlet dropdown.
const cpdSummary = computed(() => hoursByStaff(outletScopedResults.value, outletScopedAiResults.value, videoHoursByTopic(videoTrainings.value), cpdYear.value))
const { currentPage: cpdCurrentPage, totalPages: cpdTotalPages, paginatedItems: paginatedCpdSummary, next: cpdNext, prev: cpdPrev } = usePagination(cpdSummary)
const { currentPage: videoCurrentPage, totalPages: videoTotalPages, paginatedItems: paginatedVideoResults, next: videoNext, prev: videoPrev } = usePagination(filteredVideoResults)
const { currentPage: standardCurrentPage, totalPages: standardTotalPages, paginatedItems: paginatedStandardResults, next: standardNext, prev: standardPrev } = usePagination(filteredStandardResults)
const { currentPage: aiCurrentPage, totalPages: aiTotalPages, paginatedItems: paginatedAiResults, next: aiNext, prev: aiPrev } = usePagination(filteredAiResults)

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
      <div v-else-if="allResults.length === 0 && allAiResults.length === 0" class="text-slate text-sm">{{ t('areaManagerDashboard.noResultsYet') }}</div>
      <template v-else>
        <section v-if="auth.impersonating" class="mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('areaManagerDashboard.cpdHeading') }}</h2>
            <select v-model.number="cpdYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option v-for="y in cpdYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="cpdSummary.length" class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="s in paginatedCpdSummary" :key="`${s.name}|${s.outlet}`" class="px-5 py-3 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
                <p class="text-xs text-slate">{{ s.outlet }}</p>
              </div>
              <span class="text-sm font-display font-semibold shrink-0" :class="s.hours >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
                {{ t('areaManagerDashboard.cpdHoursOfTarget', { hours: s.hours, target: CPD_TARGET_HOURS }) }}
              </span>
            </div>
            <Pagination :current-page="cpdCurrentPage" :total-pages="cpdTotalPages" @prev="cpdPrev" @next="cpdNext" />
          </div>
          <div v-else class="bg-white rounded-xl2 px-5 py-4">
            <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('areaManagerDashboard.noResultsFiltered') }}</p>
          </div>
        </section>
        <section v-else class="mb-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('areaManagerDashboard.cpdHeading') }}</h2>
          <div class="bg-white rounded-xl2 px-5 py-4">
            <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('areaManagerDashboard.cpdComingSoon') }}</p>
          </div>
        </section>

        <PharmacistComplianceMatrix />

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
            <template v-else>
              <div class="space-y-3">
                <details v-for="r in paginatedVideoResults" :key="`${r.Name}|${r.Outlet}|${r.Topic}|${r.Timestamp}`" class="bg-white rounded-xl2 shadow-sm">
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
              <Pagination :current-page="videoCurrentPage" :total-pages="videoTotalPages" @prev="videoPrev" @next="videoNext" />
            </template>
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
            <template v-else>
              <div class="space-y-3">
                <details v-for="r in paginatedStandardResults" :key="`${r.Name}|${r.Outlet}|${r.Topic}|${r.Timestamp}`" class="bg-white rounded-xl2 shadow-sm">
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
              <Pagination :current-page="standardCurrentPage" :total-pages="standardTotalPages" @prev="standardPrev" @next="standardNext" />
            </template>
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
            <template v-else>
              <div class="space-y-3">
                <div v-for="r in paginatedAiResults" :key="r.AttemptID" class="bg-white rounded-xl2 shadow-sm flex items-center gap-3 px-5 py-3">
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
              <Pagination :current-page="aiCurrentPage" :total-pages="aiTotalPages" @prev="aiPrev" @next="aiNext" />
            </template>
          </template>
        </section>
      </template>
    </main>
  </div>
</template>
