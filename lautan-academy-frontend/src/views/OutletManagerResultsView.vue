<script setup>
// Split out of OutletManagerDashboard.vue — Staff Results was a section on
// the same page as Create Quiz/Manage Staff, but the sidebar nav treats it
// as its own destination.
//
// Module Quiz and AI Practice shown as two separate sections, not merged
// (same reasoning as staff's QuizHistoryView.vue) — plus wrong-answer
// review per attempt, which this page never had. Module Quiz matches
// wrong answers by name+topic (no shared attempt id in that table — a
// staff member retaking the same topic on a different day shows all of
// that topic's wrong answers together, not just the one being expanded, a
// pre-existing schema limitation shared with AreaManagerDashboard.vue). AI
// Practice matches by the real AttemptID, exact per-attempt.
import { ref, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const outlet = auth.manager?.outlet

const standardHistory = ref([])
const aiHistory = ref([])
const wrongAnswers = ref([])
const aiWrongAnswers = ref([])
const loading = ref(true)

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

function wrongsForStandard(name, topic) {
  return wrongAnswers.value.filter((w) => w['Staff Name'] === name && w.Topic === topic)
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
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="(h, i) in standardHistory" :key="i" class="px-5 py-3">
              <summary class="flex items-center justify-between cursor-pointer">
                <div>
                  <p class="text-sm font-medium text-ink">{{ h.Name }} · {{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ new Date(h.Timestamp).toLocaleDateString() }}</p>
                </div>
                <span class="text-sm font-display font-semibold shrink-0 ml-3" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                  {{ h.Score }}
                </span>
              </summary>
              <div v-if="wrongsForStandard(h.Name, h.Topic).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForStandard(h.Name, h.Topic)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">AI Practice</h2>
          <div v-if="aiHistory.length === 0" class="text-slate text-sm">No attempts yet.</div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="h in aiHistory" :key="h.AttemptID" class="px-5 py-3">
              <summary class="flex items-center justify-between cursor-pointer">
                <div>
                  <p class="text-sm font-medium text-ink">{{ h.Name }} · {{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ new Date(h.Timestamp).toLocaleDateString() }}</p>
                </div>
                <span class="text-sm font-display font-semibold shrink-0 ml-3" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
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
        </section>
      </template>
    </main>
  </div>
</template>
