<script setup>
// Split out of SupervisorDashboard.vue — now its own destination under the
// Browse Courses nav group (sits next to Browse Courses itself, since
// managing what appears there and browsing it are two different tasks that
// don't belong bundled into the company-wide activity page).
//
// Manages Content entries — the same entries quiz creation reads from as
// AI grounding material, and which also show up in Browse Courses
// (ResourcesView.vue) merged alongside Drive-backed referenceDocs.
import { ref, computed } from 'vue'
import { api } from '../api/client'

// Categories are suggested from whatever categories already exist in
// Browse Courses (Drive referenceDocs + other Content entries), so a new
// entry naturally lands under an existing section instead of inventing a
// parallel taxonomy. Still a free-text input (via datalist), not a locked
// dropdown — Drive's own categories come from folder names the app doesn't
// control, and the very first entry ever added has nothing existing to
// match yet.
const content = ref([])
const loadingContent = ref(true)
const driveCategories = ref([])
const categoryOptions = computed(() => [...new Set([...driveCategories.value, ...content.value.map(c => c.Category)])].filter(Boolean).sort())
const cTopic = ref('')
const cCategory = ref('')
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
  const [contentResult, resourcesResult] = await Promise.allSettled([api.getContent(), api.getResources()])
  if (contentResult.status === 'fulfilled') content.value = contentResult.value.content || []
  if (resourcesResult.status === 'fulfilled') driveCategories.value = [...new Set((resourcesResult.value.referenceDocs || []).map(r => r.Category))].filter(Boolean)
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
  if (!cTopic.value.trim() || !cCategory.value.trim() || !cTitle.value.trim() || !cBody.value.trim()) {
    cError.value = 'Topic, category, title, and body are required.'
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
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Supervisor</p>
      <h1 class="font-display text-xl font-semibold text-white">Add Resources</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
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
            <input v-model="cCategory" list="category-options" type="text" placeholder="e.g. Housebrand Modules"
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            <datalist id="category-options">
              <option v-for="c in categoryOptions" :key="c" :value="c" />
            </datalist>
            <p class="text-xs text-slate mt-1">Matches Browse Courses' existing categories — pick one to keep it there, or type a new one.</p>
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
    </main>
  </div>
</template>
