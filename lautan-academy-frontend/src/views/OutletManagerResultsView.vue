<script setup>
// Split out of OutletManagerDashboard.vue — Staff Results was a section on
// the same page as Create Quiz/Manage Staff, but the sidebar nav treats it
// as its own destination.
//
// Module Quiz and AI Practice shown as two separate sections, not merged
// (same reasoning as staff's QuizHistoryView.vue) — plus wrong-answer
// review per attempt, which this page never had. Module Quiz matches wrong
// answers by AttemptID, same approach as QuizHistoryView.vue and
// AreaManagerDashboard.vue: rows saved after the attempt_id migration (see
// backend migrate-add-attempt-id.js) get exact per-attempt matching; older
// rows predating it have no AttemptID on either side, so those fall back
// to the old name+topic match instead of silently showing nothing. AI
// Practice matches by the real AttemptID, exact per-attempt.
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const outlet = auth.manager?.outlet

const standardHistory = ref([])
const aiHistory = ref([])
const wrongAnswers = ref([])
const aiWrongAnswers = ref([])
const loading = ref(true)

const standardYear = ref('ALL')
const standardTopic = ref('ALL')
const aiYear = ref('ALL')
const aiTopic = ref('ALL')

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

const standardYears = computed(() => [...new Set(standardHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const standardTopics = computed(() => [...new Set(standardHistory.value.map((h) => h.Topic))].sort())
const filteredStandardHistory = computed(() => standardHistory.value.filter((h) => {
  if (standardYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== standardYear.value) return false
  if (standardTopic.value !== 'ALL' && h.Topic !== standardTopic.value) return false
  return true
}))

const aiYears = computed(() => [...new Set(aiHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const aiTopics = computed(() => [...new Set(aiHistory.value.map((h) => h.Topic))].sort())
const filteredAiHistory = computed(() => aiHistory.value.filter((h) => {
  if (aiYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== aiYear.value) return false
  if (aiTopic.value !== 'ALL' && h.Topic !== aiTopic.value) return false
  return true
}))

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function wrongsForStandard(h) {
  if (h.AttemptID) return wrongAnswers.value.filter((w) => w.AttemptID === h.AttemptID)
  return wrongAnswers.value.filter((w) => !w.AttemptID && w['Staff Name'] === h.Name && w.Topic === h.Topic)
}
function wrongsForAi(attemptId) {
  return aiWrongAnswers.value.filter((w) => w.AttemptID === attemptId)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Outlet Manager</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Results — {{ outlet }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>

      <template v-else>
        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">Module Quiz</h2>
          <div v-if="standardHistory.length === 0" class="text-slate text-sm">No attempts yet.</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">All years</option>
                <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="standardTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">All topics</option>
                <option v-for="t in standardTopics" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div v-if="filteredStandardHistory.length === 0" class="text-slate text-sm">No attempts match this filter.</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in filteredStandardHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3">
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
                <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">AI Practice</h2>
          <div v-if="aiHistory.length === 0" class="text-slate text-sm">No attempts yet.</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">All years</option>
                <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="aiTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">All topics</option>
                <option v-for="t in aiTopics" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div v-if="filteredAiHistory.length === 0" class="text-slate text-sm">No attempts match this filter.</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in filteredAiHistory" :key="h.AttemptID" class="px-5 py-3">
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
                <div v-if="wrongsForAi(h.AttemptID).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForAi(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>
      </template>
    </main>
  </div>
</template>
