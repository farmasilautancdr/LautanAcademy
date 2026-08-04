<script setup>
// Company-wide view — no outlet scoping server-side, windowMonths controls
// how far back the backend queries (0 = all time). Resources (Drive-backed
// reference docs) isn't built (see SCOPE_TRACKER.md) — Knowledge Base below
// covers the manually-typed Content sheet only, which is what quiz creation
// actually reads from.
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()

const windowMonths = ref(3) // matches GAS's default — fast first load
const loading = ref(true)
const results = ref([])
const aiResults = ref([])
const outletFilter = ref('ALL')

async function load() {
  loading.value = true
  try {
    const data = await api.getScopedData(windowMonths.value)
    results.value = data.results || []
    aiResults.value = data.aiResults || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}

watch(windowMonths, load)
load()

// --- Knowledge Base (Content) ---
// Categories match GAS's real Content-sheet categories used for retail's
// quiz-source sections. "Warehousing Handbook"/"eLearning Courses" are
// Drive-only labels in the vanilla app (never Content-sheet entries), so
// they're not offered here.
const CATEGORIES = ['SOP', 'Training Material', 'Note', 'Guideline']
const content = ref([])
const loadingContent = ref(true)
const cTopic = ref('')
const cCategory = ref(CATEGORIES[0])
const cTitle = ref('')
const cBody = ref('')
const cLink = ref('')
const cError = ref('')
const cSaving = ref(false)
const cUploading = ref(false)
const cUploadedName = ref('')
const cFileInput = ref(null)

async function loadContent() {
  loadingContent.value = true
  try {
    const data = await api.getContent()
    content.value = data.content || []
  } catch (e) { /* leave empty */ }
  loadingContent.value = false
}
loadContent()

// Uploads immediately on file selection — link field fills in with the
// resulting public URL, same field a manually-typed link would use.
async function handleFileSelect(e) {
  const file = e.target.files[0]
  if (!file) return
  cError.value = ''
  cUploading.value = true
  try {
    const data = await api.uploadContentFile(file)
    cLink.value = data.url
    cUploadedName.value = file.name
  } catch (err) {
    cError.value = err.message || 'Upload failed.'
    if (cFileInput.value) cFileInput.value.value = ''
  } finally {
    cUploading.value = false
  }
}

async function addContent() {
  cError.value = ''
  if (!cTopic.value.trim() || !cTitle.value.trim() || !cBody.value.trim()) {
    cError.value = 'Topic, title, and body are required.'
    return
  }
  cSaving.value = true
  try {
    await api.addContent({ topic: cTopic.value.trim(), category: cCategory.value, title: cTitle.value.trim(), body: cBody.value.trim(), link: cLink.value.trim() })
    cTopic.value = ''
    cTitle.value = ''
    cBody.value = ''
    cLink.value = ''
    cUploadedName.value = ''
    if (cFileInput.value) cFileInput.value.value = ''
    await loadContent()
  } catch (err) {
    cError.value = err.message || 'Could not save.'
  } finally {
    cSaving.value = false
  }
}

async function removeContent(item) {
  if (!confirm(`Remove "${item.Title}"? Quizzes sourced from this topic will fall back to general knowledge.`)) return
  try {
    await api.deleteContent(item.ID)
    await loadContent()
  } catch (e) { /* best-effort */ }
}

const activity = computed(() => {
  const tagged = [
    ...results.value.map(r => ({ ...r, kind: 'Standard' })),
    ...aiResults.value.map(r => ({ ...r, kind: 'AI Practice' })),
  ]
  const filtered = outletFilter.value === 'ALL' ? tagged : tagged.filter(r => r.Outlet === outletFilter.value)
  return filtered.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
})

const outlets = computed(() => [...new Set([...results.value, ...aiResults.value].map(r => r.Outlet))].filter(Boolean).sort())
const staffCount = computed(() => new Set([...results.value, ...aiResults.value].map(r => r.Name)).size)
const avgPercent = computed(() => {
  const all = [...results.value, ...aiResults.value]
  if (!all.length) return 0
  return Math.round(all.reduce((sum, r) => sum + (parseInt(r.Percentage) || 0), 0) / all.length)
})

function logout() {
  auth.logout()
  router.push('/supervisor-login')
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5 flex items-center justify-between">
      <div>
        <p class="text-aqualight text-xs">Supervisor</p>
        <h1 class="font-display text-xl font-semibold text-white">Company-wide</h1>
      </div>
      <button @click="logout" class="text-aqualight text-sm hover:text-white transition-colors">Log out</button>
    </header>

    <main class="max-w-4xl mx-auto px-6 py-8">
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <select v-model.number="windowMonths" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option :value="3">Last 3 months</option>
          <option :value="6">Last 6 months</option>
          <option :value="12">Last 12 months</option>
          <option :value="0">All time</option>
        </select>
        <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">All outlets</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>

      <div v-if="loading" class="text-slate text-sm">Loading...</div>

      <template v-else>
        <div class="grid grid-cols-3 gap-3 mb-8">
          <div class="bg-white rounded-xl2 p-4 text-center shadow-sm">
            <p class="font-display text-2xl font-bold text-ink">{{ staffCount }}</p>
            <p class="text-xs text-slate mt-1">Staff active</p>
          </div>
          <div class="bg-white rounded-xl2 p-4 text-center shadow-sm">
            <p class="font-display text-2xl font-bold text-ink">{{ outlets.length }}</p>
            <p class="text-xs text-slate mt-1">Outlets active</p>
          </div>
          <div class="bg-white rounded-xl2 p-4 text-center shadow-sm">
            <p class="font-display text-2xl font-bold" :class="avgPercent >= 70 ? 'text-aqua' : 'text-coral'">{{ avgPercent }}%</p>
            <p class="text-xs text-slate mt-1">Average score</p>
          </div>
        </div>

        <h2 class="font-display text-lg font-semibold text-ink mb-4">Activity Log</h2>
        <div v-if="activity.length === 0" class="text-slate text-sm">No activity in this window.</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam max-h-[32rem] overflow-y-auto">
          <div v-for="(r, i) in activity.slice(0, 100)" :key="i" class="flex items-center justify-between px-5 py-3">
            <div>
              <p class="text-sm font-medium text-ink">{{ r.Name }} · {{ r.Outlet }}</p>
              <p class="text-xs text-slate">{{ r.Topic }} · {{ r.kind }} · {{ new Date(r.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold" :class="parseInt(r.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ r.Score }}
            </span>
          </div>
        </div>
      </template>

      <section class="mt-10">
        <h2 class="font-display text-lg font-semibold text-ink mb-4">Knowledge Base</h2>

        <div v-if="loadingContent" class="text-slate text-sm">Loading...</div>
        <div v-else-if="content.length === 0" class="text-slate text-sm mb-4">No entries yet — add one below.</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
          <div v-for="item in content" :key="item.ID" class="px-5 py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ item.Title }}</p>
              <p class="text-xs text-slate">{{ item.Topic }} · {{ item.Category }}</p>
            </div>
            <button @click="removeContent(item)" class="text-coral text-xs font-medium underline shrink-0">Remove</button>
          </div>
        </div>

        <form @submit.prevent="addContent" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-ink mb-1">Topic</label>
              <input v-model="cTopic" type="text" placeholder="e.g. Handwashing Basics" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm font-medium text-ink mb-1">Category</label>
              <select v-model="cCategory" class="w-full border border-slate/30 rounded-lg py-2 px-3">
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Title</label>
            <input v-model="cTitle" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Body</label>
            <textarea v-model="cBody" rows="3" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">File (optional)</label>
            <input ref="cFileInput" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*" @change="handleFileSelect"
              class="w-full text-sm text-slate file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-aqualight file:text-deepsea file:font-medium" />
            <p v-if="cUploading" class="text-xs text-slate mt-1">Uploading...</p>
            <p v-else-if="cUploadedName" class="text-xs text-aqua mt-1">✓ {{ cUploadedName }} uploaded</p>
            <p class="text-xs text-slate mt-1">PDF, Word, PowerPoint, Excel, or images — 20MB max. Or paste a link instead:</p>
            <input v-model="cLink" type="text" placeholder="https://..." class="w-full border border-slate/30 rounded-lg py-2 px-3 mt-1" />
          </div>
          <p v-if="cError" class="text-coral text-sm">{{ cError }}</p>
          <button type="submit" :disabled="cSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
            {{ cSaving ? 'Saving...' : 'Add entry' }}
          </button>
        </form>
      </section>
    </main>
  </div>
</template>
