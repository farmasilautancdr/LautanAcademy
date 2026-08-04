<script setup>
// Per-staff rollup across every outlet — real data only (results+aiResults
// combined, same fields SupervisorDashboard already uses), no fabricated
// "trend"/"streak" metrics.
import { ref, computed, watch } from 'vue'
import { api } from '../api/client'

const windowMonths = ref(3)
const loading = ref(true)
const results = ref([])
const aiResults = ref([])
const outletFilter = ref('ALL')
const sortBy = ref('avg') // 'avg' | 'attempts' | 'name'

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

const outlets = computed(() => [...new Set([...results.value, ...aiResults.value].map(r => r.Outlet))].filter(Boolean).sort())

const rows = computed(() => {
  const all = [...results.value, ...aiResults.value]
  const filtered = outletFilter.value === 'ALL' ? all : all.filter(r => r.Outlet === outletFilter.value)
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
      <p class="text-aqualight text-xs">Supervisor</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Comparison</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <select v-model.number="windowMonths" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option :value="3">Last 3 months</option>
          <option :value="6">Last 6 months</option>
          <option :value="12">Last 12 months</option>
          <option :value="0">All time</option>
        </select>
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All outlets</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
        <select v-model="sortBy" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="avg">Sort: Avg score</option>
          <option value="attempts">Sort: Attempts</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="rows.length === 0" class="text-slate text-sm">No activity in this window.</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <div v-for="(r, i) in rows" :key="i" class="flex items-center justify-between px-5 py-3">
          <div>
            <p class="text-sm font-medium text-ink">{{ r.name }}</p>
            <p class="text-xs text-slate">{{ r.outlet }} · {{ r.attempts }} attempt{{ r.attempts === 1 ? '' : 's' }}</p>
          </div>
          <span class="text-sm font-display font-semibold" :class="r.avg >= 70 ? 'text-aqua' : 'text-coral'">{{ r.avg }}%</span>
        </div>
      </div>
    </main>
  </div>
</template>
