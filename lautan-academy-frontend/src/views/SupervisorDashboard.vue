<script setup>
// "Module Quiz Review" (sidebar `sidebar.allOutlets`, route /supervisor) —
// company-wide, Module Quiz results only. Video Training/eLearning/AI
// Practice are deliberately excluded here (they live on Staff Comparison's
// leaderboards instead) — see moduleQuizResults below. No outlet scoping
// server-side, windowMonths controls how far back the backend queries
// (0 = all time). Add Resources (Content entries) now lives on its own
// route under the Browse Courses nav group — see SupervisorAddResourcesView.vue.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useOutlets } from '../composables/useOutlets'
import { usePagination } from '../composables/usePagination'
import { videoHoursByTopic, contentHoursByTopic, splitByVideoTopic, splitByContentTopic } from '../composables/useCpdHours'
import Pagination from '../components/Pagination.vue'
import StatCard from '../components/StatCard.vue'

const ICON_USERS = 'M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
const ICON_GRID = 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'
const ICON_CHART = 'M4 20V10M4 20h16M10 20V4M16 20v-7'

const { t } = useI18n()
const { areas: AREAS, outletsForArea } = useOutlets()
const windowMonths = ref(3) // matches GAS's default — fast first load
const loading = ref(true)
const results = ref([])
const regionFilter = ref('ALL')
const outletFilter = ref('ALL')
const topicFilter = ref('ALL')
const videoTrainings = ref([])
const contentEntries = ref([])

// Picking a region narrows the outlet dropdown to that region's roster
// (whether or not those outlets have data in the current window) rather
// than only outlets already present in loaded data — matches the picker
// pattern AreaManagerReviewsView.vue already uses.
function onRegionChange() { outletFilter.value = 'ALL'; topicFilter.value = 'ALL' }
function onOutletChange() { topicFilter.value = 'ALL' }

async function load() {
  loading.value = true
  try {
    const data = await api.getScopedData(windowMonths.value)
    results.value = data.results || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}

watch(windowMonths, load)
load()

// Video Training + Module Quiz share the same `results` table, and Module
// Quiz further shares its topic namespace with Content/eLearning quizzes —
// fetched here so this whole page (stats, activity log, CSV export) can be
// narrowed to true Module Quiz only, excluding Video Training, eLearning,
// and AI Practice entirely (those stay on Staff Comparison).
// videoTrainingsLoaded gates rendering alongside `loading` (same pattern
// as SupervisorStaffComparisonView.vue) — without it, moduleQuizResults
// briefly classifies every row as Module Quiz before videoTrainings
// arrives, flashing Video Training/Content rows into the log and CSV.
const videoTrainingsLoaded = ref(false)
onMounted(async () => {
  try {
    const [videos, content] = await Promise.all([api.getVideoTrainings(), api.getContent()])
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty */ }
  videoTrainingsLoaded.value = true
})

// results.value mixes Video Training + Module Quiz + Content/eLearning in
// one table; splitByVideoTopic + splitByContentTopic peel off Video
// Training then Content, leaving true Module Quiz.
const moduleQuizResults = computed(() => {
  const video = splitByVideoTopic(results.value, videoHoursByTopic(videoTrainings.value))
  const nonVideo = splitByContentTopic(video.moduleQuiz, contentHoursByTopic(contentEntries.value))
  return nonVideo.moduleQuiz
})

// Region narrows first (canonical roster, not just outlets with data),
// outlet narrows further within that — same two-step scoping as the
// region-then-outlet flows elsewhere (e.g. AreaManagerReviewsView.vue).
const outlets = computed(() => {
  if (regionFilter.value !== 'ALL') return outletsForArea(regionFilter.value)
  return [...new Set(moduleQuizResults.value.map(r => r.Outlet))].filter(Boolean).sort()
})

const scopedModuleQuiz = computed(() => {
  let list = moduleQuizResults.value
  if (regionFilter.value !== 'ALL') {
    const regionOutlets = new Set(outletsForArea(regionFilter.value))
    list = list.filter(r => regionOutlets.has(r.Outlet))
  }
  if (outletFilter.value !== 'ALL') list = list.filter(r => r.Outlet === outletFilter.value)
  return list
})
const moduleQuizTopics = computed(() => [...new Set(scopedModuleQuiz.value.map(r => r.Topic))].filter(Boolean).sort())
// Topic-filtered — this is the single source for the stat tiles, the
// visible activity log, and the CSV export below, so what's on screen
// always matches what gets downloaded.
const filteredModuleQuiz = computed(() => {
  if (topicFilter.value === 'ALL') return scopedModuleQuiz.value
  return scopedModuleQuiz.value.filter(r => r.Topic === topicFilter.value)
})

const activity = computed(() => [...filteredModuleQuiz.value].sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)))
const staffCount = computed(() => new Set(filteredModuleQuiz.value.map(r => r.Name)).size)
const avgPercent = computed(() => {
  const all = filteredModuleQuiz.value
  if (!all.length) return 0
  return Math.round(all.reduce((sum, r) => sum + (parseInt(r.Percentage) || 0), 0) / all.length)
})
const { currentPage, totalPages, paginatedItems: paginatedActivity, next, prev } = usePagination(activity)

// Reverse of outletsForArea: outlet code -> region id, so the CSV can carry
// Region without a per-row lookup call.
const outletRegion = computed(() => {
  const map = {}
  AREAS.value.forEach(a => (a.outlets || []).forEach(o => { map[o] = a.id }))
  return map
})

// Score comes back as "correct/total" (e.g. "15/15") — Excel's CSV import
// auto-detects that shape as a date (15/15 -> "Oct-15" etc). " of " reads
// the same to a human and can't be parsed as a date.
const CSV_COLUMNS = [
  ['Timestamp', r => new Date(r.Timestamp).toISOString()],
  ['Region', r => outletRegion.value[r.Outlet] || ''],
  ['Outlet', r => r.Outlet],
  ['Staff Name', r => r.Name],
  ['Quiz Type', () => 'Module Quiz'],
  ['Topic', r => r.Topic],
  ['Score', r => (r.Score || '').replace('/', ' of ')],
  ['Percentage', r => r.Percentage],
]

function csvEscape(value) {
  let s = (value ?? '').toString()
  // A cell starting with =, +, -, or @ gets parsed as a formula by
  // Excel/Sheets on open — a leading apostrophe forces it back to plain
  // text (OWASP CSV injection mitigation), avoiding #NAME? for free-text
  // fields that happen to start with one of these.
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadCsv() {
  const header = CSV_COLUMNS.map(([label]) => csvEscape(label)).join(',')
  const rows = filteredModuleQuiz.value.map(r => CSV_COLUMNS.map(([, get]) => csvEscape(get(r))).join(','))
  // BOM so Excel opens the bilingual (EN/MS) text as UTF-8 instead of guessing wrong.
  const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `module-quiz-results-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorDashboard.title') }}</h1>
    </header>

    <main class="max-w-4xl mx-auto px-6 py-8">
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <select v-model.number="windowMonths" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option :value="3">{{ t('supervisorDashboard.last3Months') }}</option>
          <option :value="6">{{ t('supervisorDashboard.last6Months') }}</option>
          <option :value="12">{{ t('supervisorDashboard.last12Months') }}</option>
          <option :value="0">{{ t('supervisorDashboard.allTime') }}</option>
        </select>
        <select v-model="regionFilter" @change="onRegionChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorDashboard.allRegions') }}</option>
          <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
        </select>
        <select v-model="outletFilter" @change="onOutletChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorDashboard.allOutlets') }}</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
        <select v-model="topicFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorDashboard.allTopics') }}</option>
          <option v-for="tp in moduleQuizTopics" :key="tp" :value="tp">{{ tp }}</option>
        </select>
        <button type="button" @click="downloadCsv" :disabled="filteredModuleQuiz.length === 0"
          class="ml-auto bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40">
          {{ t('supervisorDashboard.downloadCsv') }}
        </button>
      </div>

      <div v-if="loading || !videoTrainingsLoaded" class="text-slate text-sm">{{ t('supervisorDashboard.loading') }}</div>

      <template v-else>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard :value="staffCount" :label="t('supervisorDashboard.staffActive')" accent="aqua" :icon="ICON_USERS" />
          <StatCard :value="outlets.length" :label="t('supervisorDashboard.outletsActive')" accent="seagrass" :icon="ICON_GRID" />
          <StatCard :value="`${avgPercent}%`" :label="t('supervisorDashboard.averageScore')" :accent="avgPercent >= 70 ? 'aqua' : 'coral'" :icon="ICON_CHART" />
        </div>

        <h2 class="font-display text-lg font-semibold text-ink mb-4">{{ t('supervisorDashboard.activityLog') }}</h2>
        <div v-if="activity.length === 0" class="text-slate text-sm">{{ t('supervisorDashboard.noActivity') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="(r, i) in paginatedActivity" :key="i" class="flex items-center justify-between px-5 py-3">
            <div>
              <p class="text-sm font-medium text-ink">{{ r.Name }} · {{ r.Outlet }}</p>
              <p class="text-xs text-slate">{{ r.Topic }} · {{ new Date(r.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold" :class="parseInt(r.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ r.Score }}
            </span>
          </div>
          <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
        </div>
      </template>
    </main>
  </div>
</template>
