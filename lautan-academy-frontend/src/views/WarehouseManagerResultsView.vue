<script setup>
// Split out of WarehouseManagerDashboard.vue — Practice History was a
// section on the same page as Create Quiz/Manage Staff.
//
// No Module Quiz section here — warehouse never has Standard Quiz results
// (matches GAS), so there's only ever one type to show, no segregation
// needed. Wrong-answer review per attempt added, same as elsewhere.
import { ref, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const location = auth.manager?.outlet
const history = ref([])
const wrongAnswers = ref([])
const loading = ref(true)

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
      <p class="text-aqualight text-xs">Warehouse Manager</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Results — {{ location }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="history.length === 0" class="text-slate text-sm">No attempts yet.</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <details v-for="h in history" :key="h.AttemptID" class="px-5 py-3">
          <summary class="flex items-center justify-between cursor-pointer">
            <div>
              <p class="text-sm font-medium text-ink">{{ h.Name }} · {{ h.Topic }}</p>
              <p class="text-xs text-slate">{{ new Date(h.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold shrink-0 ml-3" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ h.Score }}
            </span>
          </summary>
          <div v-if="wrongsFor(h.AttemptID).length" class="mt-3 space-y-2">
            <div v-for="(w, j) in wrongsFor(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
              <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
              <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
            </div>
          </div>
        </details>
      </div>
    </main>
  </div>
</template>
