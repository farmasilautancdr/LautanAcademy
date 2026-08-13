<script setup>
// Split out of DashboardView.vue — was a section on the same page as My
// Learning/Quiz History, but the sidebar nav treats it as its own
// destination, so it needs to actually be one.
//
// Shared across staff AND all 4 manager roles — GET /resources is
// company-wide with no scoping (matches GAS: every role gets the same
// referenceDocs), and nothing else here depends on which role is viewing,
// so one component covers every route rather than 5 near-duplicates.
//
// Merges two previously-separate sources into one browsable list:
// Drive-backed referenceDocs (files/links, GET /resources) and Knowledge
// entries (text body written directly in-app, GET /content — same data
// AI quiz creation already draws from). A Knowledge entry's Topic fills
// the same role as a Drive resource's Subcategory (both are the finer
// grouping under Category), so they share one category/subcategory filter
// instead of two disconnected taxonomies.
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'

const driveResources = ref([])
const knowledgeEntries = ref([])
const loading = ref(true)
const route = useRoute()
const auth = useAuthStore()
const { t } = useI18n()
// Dashboard's Browse Courses cards link here with ?category=... so the
// filter is already applied on arrival, not a plain unfiltered landing.
const categoryFilter = ref(route.query.category || 'ALL')
const subcategoryFilter = ref('ALL')

// The link between Browse Courses and AI quiz creation — only Outlet/
// Warehouse Manager have a create-quiz screen at all, so gated to that.
// Knowledge entries hand off ?topic= (matched against the content table,
// as before). Drive entries hand off ?sourceType=resource&sourceValue=
// <drive file id> — the backend now extracts real text from it live
// (Google Docs/Slides/Sheets via native export, PDF/docx/pptx/xlsx via
// download + parse, see backend services/drive.js + textExtract.js).
// Shown for every Drive entry regardless of file type — an unsupported
// type (legacy .doc/.ppt/.xls, images) just falls back to the generic-
// knowledge prompt server-side, same graceful fallback an unmatched typed
// topic already gets, not a hard failure.
const createQuizPath = computed(() => auth.manager?.role === 'warehouse_manager' ? '/warehouse-manager' : '/manager')
const canCreateQuiz = computed(() => ['outlet_manager', 'warehouse_manager'].includes(auth.manager?.role))

// Reuses Phase 1's sidebar role labels (src/i18n/locales/{en,ms}.json ->
// sidebar.roleOutletManager etc.) instead of a second copy of the same 4
// strings under a new resourcesView key.
const ROLE_KEYS = { outlet_manager: 'sidebar.roleOutletManager', warehouse_manager: 'sidebar.roleWarehouseManager', area_manager: 'sidebar.roleAreaManager', supervisor: 'sidebar.roleSupervisor' }
const headerLabel = computed(() => auth.isStaff ? auth.staff?.outlet : (ROLE_KEYS[auth.manager?.role] ? t(ROLE_KEYS[auth.manager?.role]) : ''))

onMounted(async () => {
  const [resourcesResult, contentResult] = await Promise.allSettled([api.getResources(), api.getContent()])
  if (resourcesResult.status === 'fulfilled') driveResources.value = resourcesResult.value.referenceDocs || []
  if (contentResult.status === 'fulfilled') knowledgeEntries.value = contentResult.value.content || []
  loading.value = false
})

// One shared shape for both sources — isContent marks which fields apply
// (Body/Link vs PreviewURL/Kind).
const allEntries = computed(() => [
  ...driveResources.value.map(r => ({
    id: 'drive-' + r.ID, driveId: r.ID, name: r.Name, category: r.Category, subcategory: r.Subcategory,
    kind: r.Kind, previewUrl: r.PreviewURL, isContent: false,
  })),
  ...knowledgeEntries.value.map(c => ({
    id: 'content-' + c.ID, name: c.Title, category: c.Category, subcategory: c.Topic,
    kind: 'Article', link: c.Link, body: c.Body, isContent: true,
  })),
])

const categories = computed(() => [...new Set(allEntries.value.map(e => e.category).filter(Boolean))].sort())

// Only meaningful once a specific category is picked — "ALL" spans every
// category, so subfolder/topic names from different sections would just collide.
const subcategories = computed(() => {
  if (categoryFilter.value === 'ALL') return []
  return [...new Set(allEntries.value.filter(e => e.category === categoryFilter.value && e.subcategory).map(e => e.subcategory))].sort()
})

function onCategoryChange() {
  subcategoryFilter.value = 'ALL'
}

const filteredEntries = computed(() => {
  let list = categoryFilter.value === 'ALL' ? allEntries.value : allEntries.value.filter(e => e.category === categoryFilter.value)
  if (subcategoryFilter.value !== 'ALL') list = list.filter(e => e.subcategory === subcategoryFilter.value)
  return list
})
const { currentPage, totalPages, paginatedItems: paginatedEntries, next, prev } = usePagination(filteredEntries)
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ headerLabel }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('resourcesView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('resourcesView.loading') }}</div>
      <div v-else-if="allEntries.length === 0" class="bg-white rounded-xl2 p-6 text-center">
        <p class="text-slate text-sm">{{ t('resourcesView.noMaterial') }}</p>
      </div>
      <template v-else>
        <div class="flex flex-wrap gap-2 mb-3">
          <select v-model="categoryFilter" @change="onCategoryChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">{{ t('resourcesView.allCategories') }}</option>
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
          <select v-if="subcategories.length" v-model="subcategoryFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
            <option value="ALL">{{ t('resourcesView.allTopics') }}</option>
            <option v-for="s in subcategories" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="bg-white rounded-xl2 divide-y divide-seafoam">
          <template v-for="e in paginatedEntries" :key="e.id">
            <!-- Drive-backed: opens the file/link directly, same as before. -->
            <div v-if="!e.isContent" class="flex items-center gap-3 px-5 py-3 hover:bg-seafoam transition-colors">
              <a :href="e.previewUrl" target="_blank" rel="noopener" class="flex-1 min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ e.name }}</p>
                <p class="text-xs text-slate">{{ e.category }}{{ e.subcategory ? ' · ' + e.subcategory : '' }}</p>
              </a>
              <span class="text-xs font-medium text-aqua bg-aqualight rounded-full px-2.5 py-1 shrink-0">{{ e.kind }}</span>
              <RouterLink v-if="canCreateQuiz" :to="{ path: createQuizPath, query: { sourceType: 'resource', sourceValue: e.driveId, topicLabel: e.name } }"
                class="text-xs text-white font-medium bg-aqua rounded-full px-3 py-1 shrink-0">
                {{ t('resourcesView.createQuiz') }}
              </RouterLink>
            </div>
            <!-- Knowledge entry: no file to link to (unless a link was added) — expands to read the body in place. -->
            <details v-else class="px-5 py-3 group">
              <summary class="flex items-center justify-between gap-3 cursor-pointer list-none">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ e.name }}</p>
                  <p class="text-xs text-slate">{{ e.category }}{{ e.subcategory ? ' · ' + e.subcategory : '' }}</p>
                </div>
                <span class="text-xs font-medium text-aqua bg-aqualight rounded-full px-2.5 py-1 shrink-0">{{ e.kind }}</span>
              </summary>
              <p class="text-sm text-ink mt-2 whitespace-pre-wrap">{{ e.body }}</p>
              <div class="flex items-center gap-4 mt-2">
                <a v-if="e.link" :href="e.link" target="_blank" rel="noopener" class="text-xs text-aqua font-medium underline">{{ t('resourcesView.openAttachedLink') }}</a>
                <RouterLink v-if="canCreateQuiz" :to="{ path: createQuizPath, query: { topic: e.subcategory } }" class="text-xs text-white font-medium bg-aqua rounded-full px-3 py-1">
                  {{ t('resourcesView.createQuizFromThis') }}
                </RouterLink>
              </div>
            </details>
          </template>
          <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
        </div>
      </template>
    </main>
  </div>
</template>
