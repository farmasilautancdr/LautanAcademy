<script setup>
// Split out — File a Report/Filed Reports moved to AreaManagerReviewsView.vue
// since the sidebar's "Reviews" item needs its own destination. This page
// keeps just the raw Standard Quiz results + wrong-answers browsing, which
// the sidebar's "Staff Results" item points to.
//
// auth.manager.outlet is the area id ("R1 - AMIRUL") for this role, not one
// outlet — scoped-data now returns every outlet in the region, so each
// result needs its own outlet shown rather than assuming a single one.
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const auth = useAuthStore()
const areaLabel = auth.manager?.outlet
const managerLabel = auth.manager?.label || 'Area Manager'

const results = ref([])
const wrongAnswers = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const scoped = await api.getScopedData()
    results.value = (scoped.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = scoped.wrongAnswers || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

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
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="results.length === 0" class="text-slate text-sm">No results yet for this region.</div>
      <div v-else class="space-y-3">
        <details v-for="(r, i) in results" :key="i" class="bg-white rounded-xl2 shadow-sm">
          <summary class="flex items-center justify-between px-5 py-3 cursor-pointer">
            <div>
              <p class="text-sm font-medium text-ink">{{ r.Name }} · {{ r.Topic }}</p>
              <p class="text-xs text-slate">{{ r.Outlet }} · {{ new Date(r.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold" :class="parseInt(r.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
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
