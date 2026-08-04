<script setup>
// Split out of OutletManagerDashboard.vue — Staff Results was a section on
// the same page as Create Quiz/Manage Staff, but the sidebar nav treats it
// as its own destination.
import { ref, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const outlet = auth.manager?.outlet
const history = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    history.value = [...(data.results || []), ...(data.aiResults || [])]
      .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave history empty */ }
  loading.value = false
})
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Outlet Manager</p>
      <h1 class="font-display text-xl font-semibold text-white">Staff Results — {{ outlet }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="history.length === 0" class="text-slate text-sm">No attempts yet.</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <div v-for="(h, i) in history" :key="i" class="flex items-center justify-between px-5 py-3">
          <div>
            <p class="text-sm font-medium text-ink">{{ h.Name }} · {{ h.Topic }}</p>
            <p class="text-xs text-slate">{{ new Date(h.Timestamp).toLocaleDateString() }}</p>
          </div>
          <span class="text-sm font-display font-semibold" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
            {{ h.Score }}
          </span>
        </div>
      </div>
    </main>
  </div>
</template>
