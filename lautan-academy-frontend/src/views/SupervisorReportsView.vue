<script setup>
// Company-wide Reports, read-only — Supervisor doesn't file reports (only
// Area Manager does), this just browses what's already been filed across
// every outlet. Same field set as AreaManagerReviewsView's "Filed Reports".
import { ref, computed, watch } from 'vue'
import { api } from '../api/client'

const windowMonths = ref(3)
const loading = ref(true)
const reports = ref([])
const outletFilter = ref('ALL')

async function load() {
  loading.value = true
  try {
    const data = await api.getScopedData(windowMonths.value)
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave empty */ }
  loading.value = false
}
watch(windowMonths, load)
load()

const outlets = computed(() => [...new Set(reports.value.map(r => r.Outlet))].filter(Boolean).sort())
const filtered = computed(() => outletFilter.value === 'ALL' ? reports.value : reports.value.filter(r => r.Outlet === outletFilter.value))
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Supervisor</p>
      <h1 class="font-display text-xl font-semibold text-white">Cluster Reports</h1>
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
      </div>

      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="filtered.length === 0" class="text-slate text-sm">No reports filed in this window.</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <details v-for="(r, i) in filtered" :key="i" class="px-5 py-3">
          <summary class="flex items-center justify-between cursor-pointer">
            <div>
              <p class="text-sm font-medium text-ink">{{ r['Staff Name'] }} · {{ r.Outlet }} · {{ r['Training Title'] }}</p>
              <p class="text-xs text-slate mt-0.5">Filed by {{ r.Manager }} · Competency {{ r.Fluency ?? '—' }}/10</p>
            </div>
            <span class="text-xs text-slate shrink-0 ml-3">{{ new Date(r.Timestamp).toLocaleDateString() }}</span>
          </summary>
          <div class="mt-3 space-y-2 text-sm text-ink">
            <p v-if="r['Product Knowledge Comments']"><span class="text-slate">Product Knowledge:</span> {{ r['Product Knowledge Comments'] }}</p>
            <p v-if="r['Performance Gaps']"><span class="text-slate">Gaps:</span> {{ r['Performance Gaps'] }}</p>
            <p v-if="r['Recommendations']"><span class="text-slate">Recommendations:</span> {{ r['Recommendations'] }}</p>
          </div>
        </details>
      </div>
    </main>
  </div>
</template>
