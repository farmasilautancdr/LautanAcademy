<script setup>
// Split out of DashboardView.vue — was a section on the same page as My
// Learning/Resources, but the sidebar nav treats it as its own destination,
// so it needs to actually be one.
import { ref, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import ProgressRing from '../components/ProgressRing.vue'

const history = ref([])
const loading = ref(true)
const auth = useAuthStore()

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    history.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave history empty — not fatal */ }
  loading.value = false
})

function relativeTime(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
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
      <div v-else-if="history.length === 0" class="bg-white rounded-xl2 p-6 text-center">
        <p class="text-slate text-sm">Nothing here yet — your first practice attempt will show up after you join a code.</p>
      </div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <div v-for="h in history" :key="h.AttemptID" class="flex items-center gap-4 px-5 py-3.5">
          <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#17A398' : '#FF8552'" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
            <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
          </div>
          <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
        </div>
      </div>
    </main>
  </div>
</template>
