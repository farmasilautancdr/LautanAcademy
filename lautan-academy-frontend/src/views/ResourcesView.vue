<script setup>
// Split out of DashboardView.vue — was a section on the same page as My
// Learning/Quiz History, but the sidebar nav treats it as its own
// destination, so it needs to actually be one.
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const resources = ref([])
const loading = ref(true)
const categoryFilter = ref('ALL')
const subcategoryFilter = ref('ALL')
const auth = useAuthStore()

onMounted(async () => {
  try {
    const data = await api.getResources()
    resources.value = data.referenceDocs || []
  } catch (e) { /* leave resources empty — not fatal */ }
  loading.value = false
})

const categories = computed(() => [...new Set(resources.value.map(r => r.Category))].sort())

// Only meaningful once a specific category is picked — "ALL" spans every
// category, so subfolder names from different sections would just collide.
const subcategories = computed(() => {
  if (categoryFilter.value === 'ALL') return []
  return [...new Set(resources.value.filter(r => r.Category === categoryFilter.value && r.Subcategory).map(r => r.Subcategory))].sort()
})

function onCategoryChange() {
  subcategoryFilter.value = 'ALL'
}

const filteredResources = computed(() => {
  let list = categoryFilter.value === 'ALL' ? resources.value : resources.value.filter(r => r.Category === categoryFilter.value)
  if (subcategoryFilter.value !== 'ALL') list = list.filter(r => r.Subcategory === subcategoryFilter.value)
  return list
})
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">Resources</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">Loading...</div>
      <div v-else-if="resources.length === 0" class="bg-white rounded-xl2 p-6 text-center">
        <p class="text-slate text-sm">No reference material uploaded yet.</p>
      </div>
      <template v-else>
        <div class="flex flex-wrap gap-2 mb-3">
          <select v-model="categoryFilter" @change="onCategoryChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">All categories</option>
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
          <select v-if="subcategories.length" v-model="subcategoryFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">All folders</option>
            <option v-for="s in subcategories" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="bg-white rounded-xl2 divide-y divide-seafoam">
          <a v-for="r in filteredResources" :key="r.ID" :href="r.PreviewURL" target="_blank" rel="noopener"
            class="flex items-center justify-between gap-3 px-5 py-3 hover:bg-seafoam transition-colors">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ r.Name }}</p>
              <p class="text-xs text-slate">{{ r.Category }}{{ r.Subcategory ? ' · ' + r.Subcategory : '' }}</p>
            </div>
            <span class="text-xs font-medium text-aqua bg-aqualight rounded-full px-2.5 py-1 shrink-0">{{ r.Kind }}</span>
          </a>
        </div>
      </template>
    </main>
  </div>
</template>
