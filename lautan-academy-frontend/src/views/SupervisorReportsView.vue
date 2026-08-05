<script setup>
// Company-wide Reports, read-only — Supervisor doesn't file reports (only
// Area Manager does), this just browses what's already been filed across
// every outlet. Same field set as AreaManagerReviewsView's "Filed Reports".
import { ref, computed, watch } from 'vue'
import { api } from '../api/client'
import { AREAS, outletsForArea } from '../config/areas'

const windowMonths = ref(3)
const loading = ref(true)
const reports = ref([])
const regionFilter = ref('ALL')
const outletFilter = ref('ALL')

function onRegionChange() { outletFilter.value = 'ALL' }

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

const outlets = computed(() => {
  if (regionFilter.value !== 'ALL') return outletsForArea(regionFilter.value)
  return [...new Set(reports.value.map(r => r.Outlet))].filter(Boolean).sort()
})
const filtered = computed(() => {
  let list = reports.value
  if (regionFilter.value !== 'ALL') {
    const regionOutlets = new Set(outletsForArea(regionFilter.value))
    list = list.filter(r => regionOutlets.has(r.Outlet))
  }
  if (outletFilter.value !== 'ALL') list = list.filter(r => r.Outlet === outletFilter.value)
  return list
})

// Exports exactly what's currently on screen — same region/outlet/window
// filters already applied to `filtered`, not the full unfiltered dataset.
const CSV_COLUMNS = [
  ['Timestamp', r => new Date(r.Timestamp).toISOString()],
  ['Outlet', r => r.Outlet],
  ['Staff Name', r => r['Staff Name']],
  ['Training Title', r => r['Training Title']],
  ['Manager', r => r.Manager],
  ['Quiz Score', r => r['Quiz Score']],
  ['Skill Level', r => r['Skill Level']],
  ['Competency', r => r.Fluency],
  ['Performance Gaps', r => r['Performance Gaps']],
  ['Recommendations', r => r['Recommendations']],
  ['Product Knowledge Comments', r => r['Product Knowledge Comments']],
]

function csvEscape(value) {
  const s = (value ?? '').toString()
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadCsv() {
  const header = CSV_COLUMNS.map(([label]) => csvEscape(label)).join(',')
  const rows = filtered.value.map(r => CSV_COLUMNS.map(([, get]) => csvEscape(get(r))).join(','))
  // BOM so Excel opens the bilingual (EN/MS) text as UTF-8 instead of guessing wrong.
  const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cluster-reports-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
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
        <select v-model="regionFilter" @change="onRegionChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All regions</option>
          <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
        </select>
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All outlets</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
        <button type="button" @click="downloadCsv" :disabled="filtered.length === 0"
          class="ml-auto bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40">
          Download CSV
        </button>
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
