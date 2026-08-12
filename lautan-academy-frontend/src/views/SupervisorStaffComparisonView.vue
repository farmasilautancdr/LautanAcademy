<script setup>
// Per-staff rollup across every outlet — real data only (results+aiResults
// combined, same fields SupervisorDashboard already uses), no fabricated
// "trend"/"streak" metrics.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useOutlets } from '../composables/useOutlets'
import { useAuthStore } from '../store/auth'
import { videoHoursByTopic, hoursByStaff } from '../composables/useCpdHours'

const { t } = useI18n()
const auth = useAuthStore()
const { areas: AREAS, outletsForArea } = useOutlets()
const windowMonths = ref(3)
const loading = ref(true)
const results = ref([])
const aiResults = ref([])
const regionFilter = ref('ALL')
const outletFilter = ref('ALL')
const sortBy = ref('avg') // 'avg' | 'attempts' | 'name'
const cpdResults = ref([])
const cpdAiResults = ref([])
const videoTrainings = ref([])
const CPD_TARGET_HOURS = 120

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

// Deliberately separate from `results`/`aiResults` above — those refs are
// scoped by the windowMonths dropdown (default 3 months), which would
// silently under-report a staff member's real year-to-date CPD hours
// whenever the dropdown isn't set to "All time". getScopedData(0) always
// returns every result regardless of the dropdown; useCpdHours' own year
// filter (default current calendar year) does the actual scoping this
// summary needs.
onMounted(async () => {
  try {
    const [scoped, videos] = await Promise.all([api.getScopedData(0), api.getVideoTrainings()])
    cpdResults.value = scoped.results || []
    cpdAiResults.value = scoped.aiResults || []
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty */ }
})

const cpdSummary = computed(() => hoursByStaff(cpdResults.value, cpdAiResults.value, videoHoursByTopic(videoTrainings.value)))

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
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorStaffComparisonView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <section v-if="auth.impersonating && cpdSummary.length" class="mb-8">
        <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('supervisorStaffComparisonView.cpdHeading') }}</h2>
        <div class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="s in cpdSummary" :key="`${s.name}|${s.outlet}`" class="px-5 py-3 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
              <p class="text-xs text-slate">{{ s.outlet }}</p>
            </div>
            <span class="text-sm font-display font-semibold shrink-0" :class="s.hours >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
              {{ t('supervisorStaffComparisonView.cpdHoursOfTarget', { hours: s.hours, target: CPD_TARGET_HOURS }) }}
            </span>
          </div>
        </div>
      </section>
      <section v-else-if="!auth.impersonating" class="mb-8">
        <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('supervisorStaffComparisonView.cpdHeading') }}</h2>
        <div class="bg-white rounded-xl2 px-5 py-4">
          <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('supervisorStaffComparisonView.cpdComingSoon') }}</p>
        </div>
      </section>

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
    </main>
  </div>
</template>
