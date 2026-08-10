<script setup>
// Split out of WarehouseManagerDashboard.vue — Practice History was a
// section on the same page as Create Quiz/Manage Staff.
//
// No Module Quiz section here — warehouse never has Standard Quiz results
// (matches GAS), so there's only ever one type to show, no segregation
// needed. Wrong-answer review per attempt added, same as elsewhere.
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const location = auth.manager?.outlet
const { t } = useI18n()
const history = ref([])
const wrongAnswers = ref([])
const loading = ref(true)

const filterYear = ref('ALL')
const filterTopic = ref('ALL')

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

const filterYears = computed(() => [...new Set(history.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const filterTopics = computed(() => [...new Set(history.value.map((h) => h.Topic))].sort())
const filteredHistory = computed(() => history.value.filter((h) => {
  if (filterYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== filterYear.value) return false
  if (filterTopic.value !== 'ALL' && h.Topic !== filterTopic.value) return false
  return true
}))

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    history.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.aiWrongAnswers || []
  } catch (e) { /* leave history empty */ }
  loading.value = false
})

function wrongsFor(attemptId) {
  return wrongAnswers.value.filter((w) => w.AttemptID === attemptId)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleWarehouseManager') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('warehouseManagerResultsView.title', { location }) }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('warehouseManagerResultsView.loading') }}</div>
      <div v-else-if="history.length === 0" class="text-slate text-sm">{{ t('warehouseManagerResultsView.noAttemptsYet') }}</div>
      <template v-else>
        <div class="flex flex-wrap gap-2 mb-3">
          <select v-model="filterYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">{{ t('warehouseManagerResultsView.allYears') }}</option>
            <option v-for="y in filterYears" :key="y" :value="y">{{ y }}</option>
          </select>
          <select v-model="filterTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
            <option value="ALL">{{ t('warehouseManagerResultsView.allTopics') }}</option>
            <option v-for="t2 in filterTopics" :key="t2" :value="t2">{{ t2 }}</option>
          </select>
        </div>
        <div v-if="filteredHistory.length === 0" class="text-slate text-sm">{{ t('warehouseManagerResultsView.noAttemptsFiltered') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <details v-for="h in filteredHistory" :key="h.AttemptID" class="px-5 py-3">
            <summary class="flex items-center gap-3 cursor-pointer">
              <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
              </div>
              <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                {{ h.Score }}
              </span>
            </summary>
            <div v-if="wrongsFor(h.AttemptID).length" class="mt-3 space-y-2">
              <div v-for="(w, j) in wrongsFor(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                <p class="text-xs font-medium text-coral">{{ t('warehouseManagerResultsView.questionPrefix', { text: w['Question Text'] }) }}</p>
                <p class="text-xs text-aqua font-semibold mt-1">{{ t('warehouseManagerResultsView.correctLabel', { text: w['Correct Answer'] }) }}</p>
              </div>
            </div>
          </details>
        </div>
      </template>
    </main>
  </div>
</template>
