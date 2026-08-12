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
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const { t } = useI18n()

// Categories are suggested from whatever categories already exist in
// Browse Courses (Drive referenceDocs + other Content entries), so a new
// entry naturally lands under an existing section instead of inventing a
// parallel taxonomy. Still a free-text input (via datalist), not a locked
// dropdown — Drive's own categories come from folder names the app doesn't
// control, and the very first entry ever added has nothing existing to
// match yet.
const content = ref([])
const loadingContent = ref(true)
const videoTrainings = ref([])
const loadingVideos = ref(true)
const vTitle = ref('')
const vTopic = ref('')
const vYoutubeUrl = ref('')
const vHours = ref('1')
const vError = ref('')
const vSaving = ref(false)
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

async function loadVideoTrainings() {
  loadingVideos.value = true
  try {
    const data = await api.getVideoTrainings()
    videoTrainings.value = data.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loadingVideos.value = false
}
loadVideoTrainings()

async function addVideoTraining() {
  vError.value = ''
  if (!vTitle.value.trim() || !vTopic.value.trim() || !vYoutubeUrl.value.trim()) {
    vError.value = t('supervisorAddResourcesView.videoErrorRequiredFields')
    return
  }
  const hours = parseFloat(vHours.value)
  if (!Number.isFinite(hours) || hours <= 0) {
    vError.value = t('supervisorAddResourcesView.videoErrorBadHours')
    return
  }
  vSaving.value = true
  try {
    await api.addVideoTraining({ title: vTitle.value.trim(), topic: vTopic.value.trim(), youtubeUrl: vYoutubeUrl.value.trim(), hours })
    vTitle.value = ''
    vTopic.value = ''
    vYoutubeUrl.value = ''
    vHours.value = '1'
    await loadVideoTrainings()
  } catch (err) {
    vError.value = err.message || t('supervisorAddResourcesView.videoErrorSaveFailed')
  } finally {
    vSaving.value = false
  }
}

async function removeVideoTraining(video) {
  if (!confirm(t('supervisorAddResourcesView.videoConfirmRemove', { title: video.title }))) return
  try {
    await api.deleteVideoTraining(video.id)
    await loadVideoTrainings()
  } catch (e) { /* best-effort */ }
}

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
    cError.value = err.message || t('supervisorAddResourcesView.errorUploadFailed')
    if (cFileInput.value) cFileInput.value.value = ''
  } finally {
    cUploading.value = false
  }
}

async function addContent() {
  cError.value = ''
  if (!cTopic.value.trim() || !cCategory.value.trim() || !cTitle.value.trim() || !cBody.value.trim()) {
    cError.value = t('supervisorAddResourcesView.errorRequiredFields')
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
    cError.value = err.message || t('supervisorAddResourcesView.errorSaveFailed')
  } finally {
    cSaving.value = false
  }
}

async function removeContent(item) {
  if (!confirm(t('supervisorAddResourcesView.confirmRemove', { title: item.Title }))) return
  try {
    await api.deleteContent(item.ID)
    await loadContent()
  } catch (e) { /* best-effort */ }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorAddResourcesView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loadingContent" class="text-slate text-sm">{{ t('supervisorAddResourcesView.loading') }}</div>
      <div v-else-if="content.length === 0" class="text-slate text-sm mb-4">{{ t('supervisorAddResourcesView.noEntriesYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
        <div v-for="item in content" :key="item.ID" class="px-5 py-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ item.Title }}</p>
            <p class="text-xs text-slate">{{ item.Topic }} · {{ item.Category }}</p>
          </div>
          <button @click="removeContent(item)" class="text-coral text-xs font-medium underline shrink-0">{{ t('supervisorAddResourcesView.remove') }}</button>
        </div>
      </div>

      <form @submit.prevent="addContent" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.topicLabel') }}</label>
            <input v-model="cTopic" type="text" :placeholder="t('supervisorAddResourcesView.topicPlaceholder')" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.categoryLabel') }}</label>
            <input v-model="cCategory" list="category-options" type="text" :placeholder="t('supervisorAddResourcesView.categoryPlaceholder')"
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            <datalist id="category-options">
              <option v-for="c in categoryOptions" :key="c" :value="c" />
            </datalist>
            <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.categoryHelper') }}</p>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.titleLabel') }}</label>
          <input v-model="cTitle" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.bodyLabel') }}</label>
          <textarea v-model="cBody" rows="3" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.fileLabel') }}</label>
          <input ref="cFileInput" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*" @change="handleFileSelect"
            class="w-full text-sm text-slate file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-aqualight file:text-deepsea file:font-medium" />
          <p v-if="cUploading" class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.uploading') }}</p>
          <p v-else-if="cUploadedName" class="text-xs text-aqua mt-1">{{ t('supervisorAddResourcesView.uploaded', { name: cUploadedName }) }}</p>
          <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.fileHelper') }}</p>
          <input v-model="cLink" type="text" :placeholder="t('supervisorAddResourcesView.linkPlaceholder')" class="w-full border border-slate/30 rounded-lg py-2 px-3 mt-1" />
        </div>
        <p v-if="cError" class="text-coral text-sm">{{ cError }}</p>
        <button type="submit" :disabled="cSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
          {{ cSaving ? t('supervisorAddResourcesView.saving') : t('supervisorAddResourcesView.addEntry') }}
        </button>
      </form>

      <h2 class="font-display text-lg font-semibold text-ink mt-8 mb-3">{{ t('supervisorAddResourcesView.videoSectionTitle') }}</h2>

      <div v-if="loadingVideos" class="text-slate text-sm">{{ t('supervisorAddResourcesView.loading') }}</div>
      <div v-else-if="videoTrainings.length === 0" class="text-slate text-sm mb-4">{{ t('supervisorAddResourcesView.videoNoEntriesYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
        <div v-for="video in videoTrainings" :key="video.id" class="px-5 py-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ video.title }}</p>
            <p class="text-xs text-slate">{{ video.topic }} · {{ t('supervisorAddResourcesView.videoHoursValue', { hours: video.hours }) }}</p>
          </div>
          <button @click="removeVideoTraining(video)" class="text-coral text-xs font-medium underline shrink-0">{{ t('supervisorAddResourcesView.remove') }}</button>
        </div>
      </div>

      <form @submit.prevent="addVideoTraining" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.titleLabel') }}</label>
          <input v-model="vTitle" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoTopicLabel') }}</label>
          <input v-model="vTopic" type="text" :placeholder="t('supervisorAddResourcesView.topicPlaceholder')" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.videoTopicHelper') }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoLinkLabel') }}</label>
          <input v-model="vYoutubeUrl" type="text" placeholder="https://www.youtube.com/watch?v=..." class="w-full border border-slate/30 rounded-lg py-2 px-3" />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoHoursLabel') }}</label>
          <input v-model="vHours" type="number" step="0.5" min="0.5" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.videoHoursHelper') }}</p>
        </div>
        <p v-if="vError" class="text-coral text-sm">{{ vError }}</p>
        <button type="submit" :disabled="vSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
          {{ vSaving ? t('supervisorAddResourcesView.saving') : t('supervisorAddResourcesView.videoAddEntry') }}
        </button>
      </form>
    </main>
  </div>
</template>
