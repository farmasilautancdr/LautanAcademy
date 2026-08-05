<script setup>
// Split out of DashboardView.vue — was a section on the same page as My
// Learning/Resources, but the sidebar nav treats it as its own destination,
// so it needs to actually be one.
//
// Module Quiz (Standard) and AI Practice are kept as two separate sections,
// not merged into one list — different data sources, different rules
// (Module Quiz result rows have no shared attempt id, so wrong-answer
// review below matches by topic only; a topic retaken on a different day
// will show wrong answers from every attempt of that topic together, not
// just the one being expanded — a pre-existing schema limitation, same one
// AreaManagerDashboard.vue already has. AI Practice rows have a real
// AttemptID, so that review is exact per-attempt.
import { ref, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import ProgressRing from '../components/ProgressRing.vue'

const standardHistory = ref([])
const aiHistory = ref([])
const wrongAnswers = ref([])
const aiWrongAnswers = ref([])
const reports = ref([])
const loading = ref(true)
const auth = useAuthStore()

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false
})

// Same thresholds AreaManagerReviewsView uses to compute the badge when
// filing — reports store the label already, this just picks its color.
function skillLevelColor(level) {
  if (level === 'HIGH') return 'text-aqua'
  if (level === 'LOW') return 'text-coral'
  return 'text-ink'
}

function relativeTime(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

// Attempts saved after the attempt_id migration (see backend
// migrate-add-attempt-id.js) get exact per-attempt matching. Older rows
// predating it have no AttemptID on either side — for those only, fall
// back to the old topic-only match so they don't silently show nothing,
// accepting the old cross-attempt-mixing limitation just for that legacy
// data rather than reintroducing it for new attempts too.
function wrongsForStandard(h) {
  if (h.AttemptID) return wrongAnswers.value.filter((w) => w.AttemptID === h.AttemptID)
  return wrongAnswers.value.filter((w) => !w.AttemptID && w.Topic === h.Topic)
}
function wrongsForAi(attemptId) {
  return aiWrongAnswers.value.filter((w) => w.AttemptID === attemptId)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">Quiz History</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>

      <template v-else>
        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">Module Quiz</h2>
          <div v-if="standardHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">Nothing here yet — take a module quiz from the sidebar.</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="(h, i) in standardHistory" :key="i" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">AI Practice</h2>
          <div v-if="aiHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">Nothing here yet — your first practice attempt will show up after you join a code.</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="h in aiHistory" :key="h.AttemptID" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
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

        <section v-if="auth.staff?.division === 'retail'" class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">Assessment Review</h2>
          <div v-if="reports.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">No assessments filed for you yet.</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="(r, i) in reports" :key="i" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ r['Training Title'] }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(r.Timestamp) }} · Filed by {{ r.Manager }}</p>
                </div>
                <span class="text-sm font-display font-semibold shrink-0" :class="skillLevelColor(r['Skill Level'])">{{ r['Skill Level'] }}</span>
              </summary>
              <div class="mt-3 space-y-2">
                <div class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs text-slate">Quiz score: <span class="font-medium text-ink">{{ r['Quiz Score'] }}%</span> · Competency: <span class="font-medium text-ink">{{ r.Fluency ?? '—' }}/10</span></p>
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
        </section>
      </template>
    </main>
  </div>
</template>
