<script setup>
// Read-only view of Area Manager assessments for this outlet's staff —
// same year/topic filter + date badge pattern as the staff-side Assessment
// Review section (QuizHistoryView.vue), but spans every staff member at
// the outlet rather than one person, so each card also shows Staff Name.
// Warehouse Manager has no equivalent: backend never returns reports for
// warehouse_manager scope (data.js) — matches GAS, which never had a
// Product Knowledge assessment flow for warehouse staff.
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const outlet = auth.manager?.outlet

const reports = ref([])
const loading = ref(true)

const reportYear = ref('ALL')
const reportTopic = ref('ALL')

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function skillLevelColor(level) {
  if (level === 'HIGH') return 'text-aqua'
  if (level === 'LOW') return 'text-coral'
  return 'text-ink'
}

const reportYears = computed(() => [...new Set(reports.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const reportTopics = computed(() => [...new Set(reports.value.map((r) => r['Training Title']))].sort())

const filteredReports = computed(() => reports.value.filter((r) => {
  if (reportYear.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== reportYear.value) return false
  if (reportTopic.value !== 'ALL' && r['Training Title'] !== reportTopic.value) return false
  return true
}))

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Outlet Manager</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Review — {{ outlet }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="reports.length === 0" class="bg-white rounded-xl2 p-6 text-center">
        <p class="text-slate text-sm">No assessments filed for this outlet yet.</p>
      </div>
      <template v-else>
        <div class="flex flex-wrap gap-2 mb-3">
          <select v-model="reportYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">All years</option>
            <option v-for="y in reportYears" :key="y" :value="y">{{ y }}</option>
          </select>
          <select v-model="reportTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">All topics</option>
            <option v-for="t in reportTopics" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div v-if="filteredReports.length === 0" class="bg-white rounded-xl2 p-6 text-center">
          <p class="text-slate text-sm">No assessments match this filter.</p>
        </div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <details v-for="r in filteredReports" :key="`${r['Staff Name']}|${r['Training Title']}|${r.Timestamp}`" class="px-5 py-3.5">
            <summary class="flex items-center gap-4 cursor-pointer">
              <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(r.Timestamp).month }}</p>
                <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(r.Timestamp).day }}</p>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ r['Staff Name'] }} · {{ r['Training Title'] }}</p>
                <p class="text-xs text-slate">Filed by {{ r.Manager }}</p>
              </div>
              <span class="text-sm font-display font-semibold shrink-0" :class="skillLevelColor(r['Skill Level'])">{{ r['Skill Level'] }}</span>
            </summary>
            <div class="mt-3 space-y-2">
              <div class="bg-seafoam rounded-lg p-3">
                <p class="text-xs text-slate">Quiz score: <span class="font-medium text-ink">{{ r['Quiz Score'] }}</span> · Competency: <span class="font-medium text-ink">{{ r.Fluency ?? '—' }}/10</span></p>
              </div>
              <div v-if="r['Product Knowledge Comments']" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-ink">Product knowledge</p>
                <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r['Product Knowledge Comments'] }}</p>
              </div>
              <div v-if="r['Performance Gaps']" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-ink">Performance gaps</p>
                <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r['Performance Gaps'] }}</p>
              </div>
              <div v-if="r.Recommendations" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-ink">Recommendations</p>
                <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r.Recommendations }}</p>
              </div>
            </div>
          </details>
        </div>
      </template>
    </main>
  </div>
</template>
