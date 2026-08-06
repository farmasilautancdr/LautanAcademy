<script setup>
// Split out — File a Report/Filed Reports moved to AreaManagerReviewsView.vue
// since the sidebar's "Reviews" item needs its own destination. This page
// keeps just the raw Standard Quiz results + wrong-answers browsing, which
// the sidebar's "Staff Results" item points to.
//
// auth.manager.outlet is the area id ("R1 - AMIRUL") for this role, not one
// outlet — scoped-data now returns every outlet in the region, so each
// result needs its own outlet shown rather than assuming a single one.
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const auth = useAuthStore()
const areaLabel = auth.manager?.outlet
const regionOutlets = auth.manager?.outlets || []
const managerLabel = auth.manager?.label || 'Area Manager'

const allResults = ref([])
const wrongAnswers = ref([])
const loading = ref(true)
const outletFilter = ref('ALL')
const yearFilter = ref('ALL')
const topicFilter = ref('ALL')

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

onMounted(async () => {
  try {
    const scoped = await api.getScopedData()
    allResults.value = (scoped.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = scoped.wrongAnswers || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

const outletScopedResults = computed(() => outletFilter.value === 'ALL' ? allResults.value : allResults.value.filter((r) => r.Outlet === outletFilter.value))
const resultYears = computed(() => [...new Set(outletScopedResults.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const resultTopics = computed(() => [...new Set(outletScopedResults.value.map((r) => r.Topic))].sort())
const results = computed(() => outletScopedResults.value.filter((r) => {
  if (yearFilter.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== yearFilter.value) return false
  if (topicFilter.value !== 'ALL' && r.Topic !== topicFilter.value) return false
  return true
}))

// Staff names aren't unique across a region's outlets, so wrong-answers
// must match on outlet too, not just name+topic.
function wrongsFor(name, outlet, topic) {
  return wrongAnswers.value.filter(w => w['Staff Name'] === name && w.Outlet === outlet && w.Topic === topic)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ managerLabel }}</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Results — {{ areaLabel }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="flex flex-wrap gap-2 mb-6">
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All outlets in region</option>
          <option v-for="o in regionOutlets" :key="o" :value="o">{{ o }}</option>
        </select>
        <select v-model="yearFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All years</option>
          <option v-for="y in resultYears" :key="y" :value="y">{{ y }}</option>
        </select>
        <select v-model="topicFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All topics</option>
          <option v-for="t in resultTopics" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="results.length === 0" class="text-slate text-sm">No results match this filter.</div>
      <div v-else class="space-y-3">
        <details v-for="(r, i) in results" :key="i" class="bg-white rounded-xl2 shadow-sm">
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
          <div v-if="wrongsFor(r.Name, r.Outlet, r.Topic).length" class="px-5 pb-4 space-y-2">
            <div v-for="(w, j) in wrongsFor(r.Name, r.Outlet, r.Topic)" :key="j" class="bg-seafoam rounded-lg p-3">
              <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
              <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
            </div>
          </div>
        </details>
      </div>
    </main>
  </div>
</template>
