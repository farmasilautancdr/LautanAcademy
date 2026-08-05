<script setup>
// Company-wide view — no outlet scoping server-side, windowMonths controls
// how far back the backend queries (0 = all time). Add Resources (Content
// entries) now lives on its own route under the Browse Courses nav group
// — see SupervisorAddResourcesView.vue.
import { ref, computed, watch } from 'vue'
import { api } from '../api/client'
import { AREAS, outletsForArea } from '../config/areas'

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
    ...results.value.map(r => ({ ...r, kind: 'Standard' })),
    ...aiResults.value.map(r => ({ ...r, kind: 'AI Practice' })),
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

</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Supervisor</p>
      <h1 class="font-display text-xl font-semibold text-white">Company-wide</h1>
    </header>

    <main class="max-w-4xl mx-auto px-6 py-8">
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <select v-model.number="windowMonths" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option :value="3">Last 3 months</option>
          <option :value="6">Last 6 months</option>
          <option :value="12">Last 12 months</option>
          <option :value="0">All time</option>
        </select>
        <select v-model="regionFilter" @change="onRegionChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All regions</option>
          <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
        </select>
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All outlets</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">Loading...</div>

      <template v-else>
        <div class="grid grid-cols-3 gap-3 mb-8">
          <div class="bg-white rounded-xl2 p-4 text-center shadow-sm">
            <p class="font-display text-2xl font-bold text-ink">{{ staffCount }}</p>
            <p class="text-xs text-slate mt-1">Staff active</p>
          </div>
          <div class="bg-white rounded-xl2 p-4 text-center shadow-sm">
            <p class="font-display text-2xl font-bold text-ink">{{ outlets.length }}</p>
            <p class="text-xs text-slate mt-1">Outlets active</p>
          </div>
          <div class="bg-white rounded-xl2 p-4 text-center shadow-sm">
            <p class="font-display text-2xl font-bold" :class="avgPercent >= 70 ? 'text-aqua' : 'text-coral'">{{ avgPercent }}%</p>
            <p class="text-xs text-slate mt-1">Average score</p>
          </div>
        </div>

        <h2 class="font-display text-lg font-semibold text-ink mb-4">Activity Log</h2>
        <div v-if="activity.length === 0" class="text-slate text-sm">No activity in this window.</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam max-h-[32rem] overflow-y-auto">
          <div v-for="(r, i) in activity.slice(0, 100)" :key="i" class="flex items-center justify-between px-5 py-3">
            <div>
              <p class="text-sm font-medium text-ink">{{ r.Name }} · {{ r.Outlet }}</p>
              <p class="text-xs text-slate">{{ r.Topic }} · {{ r.kind }} · {{ new Date(r.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold" :class="parseInt(r.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ r.Score }}
            </span>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
