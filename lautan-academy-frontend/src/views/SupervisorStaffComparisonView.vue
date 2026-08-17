<script setup>
// Per-staff rollup across every outlet — real data only (results+aiResults
// combined, same fields SupervisorDashboard already uses), no fabricated
// "trend"/"streak" metrics.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useOutlets } from '../composables/useOutlets'
import { useAuthStore } from '../store/auth'
import { videoHoursByTopic, contentHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'
import PharmacistComplianceMatrix from '../components/PharmacistComplianceMatrix.vue'

const { t } = useI18n()
const auth = useAuthStore()
const { areas: AREAS, outletsForArea } = useOutlets()
const windowMonths = ref(3)
const loading = ref(true)
const results = ref([])
const aiResults = ref([])
const regionFilter = ref('ALL')
const outletFilter = ref('ALL')
const cpdResults = ref([])
const cpdAiResults = ref([])
const videoTrainings = ref([])
const contentEntries = ref([])
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

function onRegionChange() { outletFilter.value = 'ALL' }

// Every year/topic filter's option list is derived from region/outlet-scoped
// data, so a value picked under one scope can be meaningless under another
// (renders blank, list goes empty) — reset all six back to ALL whenever any
// of the three scope controls change. cpdYear is left alone — the current
// year is always a valid, always-present option regardless of scope. The
// three sort refs are scope-independent and don't need resetting.
watch([windowMonths, regionFilter, outletFilter], () => {
  videoYear.value = 'ALL'
  videoTopic.value = 'ALL'
  standardYear.value = 'ALL'
  standardTopic.value = 'ALL'
  aiYear.value = 'ALL'
  aiTopic.value = 'ALL'
})

async function load() {
  loading.value = true
  try {
    const data = await api.getScopedData(windowMonths.value)
    results.value = data.results || []
    aiResults.value = data.aiResults || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}
watch(windowMonths, load)
load()

// Deliberately separate from `results`/`aiResults` above — those refs are
// scoped by the windowMonths dropdown (default 3 months), which would
// silently under-report a staff member's real year-to-date CPD hours
// whenever the dropdown isn't set to "All time". getScopedData(0) always
// returns every result regardless of the dropdown; useCpdHours' own year
// filter (default current calendar year) does the actual scoping this
// summary needs.
//
// videoTrainingsLoaded gates the page-level loading state alongside
// `loading` (load()'s own flag) so the leaderboards don't render before
// videoTrainings arrives — without it, splitResults briefly classifies
// every row as Module Quiz (videoHoursByTopic has nothing yet), flashing
// an empty Video Training section + an over-full Module Quiz section.
const videoTrainingsLoaded = ref(false)
onMounted(async () => {
  try {
    const [scoped, videos, content] = await Promise.all([api.getScopedData(0), api.getVideoTrainings(), api.getContent()])
    cpdResults.value = scoped.results || []
    cpdAiResults.value = scoped.aiResults || []
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty */ }
  videoTrainingsLoaded.value = true
})

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
const cpdSummary = computed(() => hoursByStaff(outletScoped(cpdResults.value), outletScoped(cpdAiResults.value), videoHoursByTopic(videoTrainings.value), contentHoursByTopic(contentEntries.value), cpdYear.value))
const { currentPage: cpdCurrentPage, totalPages: cpdTotalPages, paginatedItems: paginatedCpdSummary, next: cpdNext, prev: cpdPrev } = usePagination(cpdSummary)
const { currentPage: videoCurrentPage, totalPages: videoTotalPages, paginatedItems: paginatedVideoRows, next: videoNext, prev: videoPrev } = usePagination(videoRows)
const { currentPage: standardCurrentPage, totalPages: standardTotalPages, paginatedItems: paginatedStandardRows, next: standardNext, prev: standardPrev } = usePagination(standardRows)
const { currentPage: aiCurrentPage, totalPages: aiTotalPages, paginatedItems: paginatedAiRows, next: aiNext, prev: aiPrev } = usePagination(aiRows)
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorStaffComparisonView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <section class="mb-8">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 class="font-display text-base font-semibold text-ink">{{ t('supervisorStaffComparisonView.cpdHeading') }}</h2>
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
              {{ t('supervisorStaffComparisonView.cpdHoursOfTarget', { hours: s.hours, target: CPD_TARGET_HOURS }) }}
            </span>
          </div>
          <Pagination :current-page="cpdCurrentPage" :total-pages="cpdTotalPages" @prev="cpdPrev" @next="cpdNext" />
        </div>
        <div v-else class="bg-white rounded-xl2 px-5 py-4">
          <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('supervisorStaffComparisonView.cpdNoData') }}</p>
        </div>
      </section>

      <PharmacistComplianceMatrix />

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

      <div v-if="loading || !videoTrainingsLoaded" class="text-slate text-sm">{{ t('supervisorStaffComparisonView.loading') }}</div>
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
            <div v-for="(r, i) in paginatedVideoRows" :key="i" class="flex items-center justify-between px-5 py-3">
              <div>
                <p class="text-sm font-medium text-ink">{{ r.name }}</p>
                <p class="text-xs text-slate">{{ r.outlet }} · {{ t('supervisorStaffComparisonView.attemptsCount', r.attempts) }}</p>
              </div>
              <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
            </div>
            <Pagination :current-page="videoCurrentPage" :total-pages="videoTotalPages" @prev="videoPrev" @next="videoNext" />
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
            <div v-for="(r, i) in paginatedStandardRows" :key="i" class="flex items-center justify-between px-5 py-3">
              <div>
                <p class="text-sm font-medium text-ink">{{ r.name }}</p>
                <p class="text-xs text-slate">{{ r.outlet }} · {{ t('supervisorStaffComparisonView.attemptsCount', r.attempts) }}</p>
              </div>
              <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
            </div>
            <Pagination :current-page="standardCurrentPage" :total-pages="standardTotalPages" @prev="standardPrev" @next="standardNext" />
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
            <div v-for="(r, i) in paginatedAiRows" :key="i" class="flex items-center justify-between px-5 py-3">
              <div>
                <p class="text-sm font-medium text-ink">{{ r.name }}</p>
                <p class="text-xs text-slate">{{ r.outlet }} · {{ t('supervisorStaffComparisonView.attemptsCount', r.attempts) }}</p>
              </div>
              <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
            </div>
            <Pagination :current-page="aiCurrentPage" :total-pages="aiTotalPages" @prev="aiPrev" @next="aiNext" />
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
