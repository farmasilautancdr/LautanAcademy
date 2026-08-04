<script setup>
// View-only for now. GAS's real Area Manager workflow is submitting a
// per-staff Report (skill level, competency comments, housebrand focus,
// performance gaps, recommendations, ratings) — that feature isn't built
// here yet, backend's `reports` table is a 3-column stub pending a schema
// rebuild (see SCOPE_TRACKER.md). This dashboard only shows what the
// backend actually has: outlet-wide Standard Quiz results + wrong answers.
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const outlet = auth.manager?.outlet

const results = ref([])
const wrongAnswers = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    results.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function wrongsFor(name, topic) {
  return wrongAnswers.value.filter(w => w['Staff Name'] === name && w.Topic === topic)
}

function logout() {
  auth.logout()
  router.push('/area-manager-login')
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5 flex items-center justify-between">
      <div>
        <p class="text-aqualight text-xs">Area Manager</p>
        <h1 class="font-display text-xl font-semibold text-white">{{ outlet }}</h1>
      </div>
      <button @click="logout" class="text-aqualight text-sm hover:text-white transition-colors">Log out</button>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="bg-aqualight/40 border border-aqua/30 rounded-xl2 p-4 mb-6 text-sm text-deepsea">
        Manager review/report submission isn't available in this stack yet —
        this view is Standard Quiz results only. Use the existing system for reports.
      </div>

      <h2 class="font-display text-lg font-semibold text-ink mb-4">Standard Quiz Results — {{ outlet }}</h2>
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="results.length === 0" class="text-slate text-sm">No results yet for this outlet.</div>
      <div v-else class="space-y-3">
        <details v-for="(r, i) in results" :key="i" class="bg-white rounded-xl2 shadow-sm">
          <summary class="flex items-center justify-between px-5 py-3 cursor-pointer">
            <div>
              <p class="text-sm font-medium text-ink">{{ r.Name }} · {{ r.Topic }}</p>
              <p class="text-xs text-slate">{{ new Date(r.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold" :class="parseInt(r.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ r.Score }}
            </span>
          </summary>
          <div v-if="wrongsFor(r.Name, r.Topic).length" class="px-5 pb-4 space-y-2">
            <div v-for="(w, j) in wrongsFor(r.Name, r.Topic)" :key="j" class="bg-seafoam rounded-lg p-3">
              <p class="text-xs font-medium text-coral">Q: {{ w['Question Text'] }}</p>
              <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w['Correct Answer'] }}</p>
            </div>
          </div>
        </details>
      </div>
    </main>
  </div>
</template>
