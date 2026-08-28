<script setup>
// Company-wide view — no outlet scoping server-side, windowMonths controls
// how far back the backend queries (0 = all time). Add Resources (Content
// entries) now lives on its own route under the Browse Courses nav group
// — see SupervisorAddResourcesView.vue.
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useOutlets } from '../composables/useOutlets'
import { usePagination } from '../composables/usePagination'
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
const aiResults = ref([])
const regionFilter = ref('ALL')
const outletFilter = ref('ALL')

// Picking a region narrows the outlet dropdown to that region's roster
// (whether or not those outlets have data in the current window) rather
// than only outlets already present in loaded data — matches the picker
// pattern AreaManagerReviewsView.vue already uses.
function onRegionChange() { outletFilter.value = 'ALL' }

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

// Region narrows first (canonical roster, not just outlets with data),
// outlet narrows further within that — same two-step scoping as the
// region-then-outlet flows elsewhere (e.g. AreaManagerReviewsView.vue).
// Stat tiles now reflect both filters too, not just the activity log below
// — they only ever reflected outletFilter=ALL before, an inconsistency
// with the log fixed here rather than carried into the new region filter.
const outlets = computed(() => {
  if (regionFilter.value !== 'ALL') return outletsForArea(regionFilter.value)
  return [...new Set([...results.value, ...aiResults.value].map(r => r.Outlet))].filter(Boolean).sort()
})

const scopedActivity = computed(() => {
  const tagged = [
    ...results.value.map(r => ({ ...r, kind: t('supervisorDashboard.kindStandard') })),
    ...aiResults.value.map(r => ({ ...r, kind: t('supervisorDashboard.kindAiPractice') })),
  ]
  let list = tagged
  if (regionFilter.value !== 'ALL') {
    const regionOutlets = new Set(outletsForArea(regionFilter.value))
    list = list.filter(r => regionOutlets.has(r.Outlet))
  }
  if (outletFilter.value !== 'ALL') list = list.filter(r => r.Outlet === outletFilter.value)
  return list
})

const activity = computed(() => [...scopedActivity.value].sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)))
const staffCount = computed(() => new Set(scopedActivity.value.map(r => r.Name)).size)
const avgPercent = computed(() => {
  const all = scopedActivity.value
  if (!all.length) return 0
  return Math.round(all.reduce((sum, r) => sum + (parseInt(r.Percentage) || 0), 0) / all.length)
})
const { currentPage, totalPages, paginatedItems: paginatedActivity, next, prev } = usePagination(activity)

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
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorDashboard.allOutlets') }}</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">{{ t('supervisorDashboard.loading') }}</div>

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
              <p class="text-xs text-slate">{{ r.Topic }} · {{ r.kind }} · {{ new Date(r.Timestamp).toLocaleDateString() }}</p>
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
