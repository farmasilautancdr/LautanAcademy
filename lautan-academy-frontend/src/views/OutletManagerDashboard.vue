<script setup>
// Topic can be typed free-text, or picked from the dropdown below — which
// now lists the SAME two sources Browse Courses actually shows (Knowledge
// entries AND Drive files), not just Knowledge entries like it used to.
// Previously this dropdown only ever showed Content topics, so anyone
// whose Browse Courses content was Drive files (the common case — see
// ResourcesView.vue) saw nothing here that matched what they'd actually
// browsed. Picking a Drive file sets sourceType 'resource' + the file id;
// picking a Knowledge topic (or Browse Courses' own "Create Quiz" button,
// which hands off via query params the same two ways) sets 'topic'.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const auth = useAuthStore()
const route = useRoute()
const { t } = useI18n()
const outlet = auth.manager?.outlet
const managerLabel = `PIC Outlet - ${outlet}`

const topicLabel = ref('')
const extraNotes = ref('')
const count = ref(10)
const creating = ref(false)
const createError = ref('')
const resourceSource = ref('') // Drive file id, set only via a Browse Courses hand-off
const selectedCourseKey = ref('') // dropdown's own selection, kept in sync with resourceSource/topicLabel
function clearResourceSource() { resourceSource.value = ''; selectedCourseKey.value = '' }

const activeQuiz = ref(null) // { passcode, topic, count, createdAt }
const remaining = ref('')
let timerHandle = null

// Same category/subcategory shape Browse Courses itself uses (see
// ResourcesView.vue) — Category is the main group (Housebrand Modules,
// SOP, etc.), Topic/Subcategory is the finer grouping under it. Narrowing
// through both before picking a specific course replaces what used to be
// one long flat list.
const allCourseOptions = ref([])

async function loadCourseOptions() {
  const [contentResult, resourcesResult] = await Promise.allSettled([api.getContent(), api.getResources()])
  const opts = []
  if (contentResult.status === 'fulfilled') {
    for (const c of (contentResult.value.content || [])) {
      opts.push({ key: 'topic::' + c.ID, label: c.Title, category: c.Category, subcategory: c.Topic, sourceType: 'topic', sourceValue: c.Topic })
    }
  }
  if (resourcesResult.status === 'fulfilled') {
    for (const r of (resourcesResult.value.referenceDocs || [])) {
      opts.push({ key: 'resource::' + r.ID, label: r.Name, category: r.Category, subcategory: r.Subcategory, sourceType: 'resource', sourceValue: r.ID })
    }
  }
  allCourseOptions.value = opts
}

const categoryFilter = ref('ALL')
const subcategoryFilter = ref('ALL')
const categories = computed(() => [...new Set(allCourseOptions.value.map(o => o.category).filter(Boolean))].sort())
const subcategories = computed(() => {
  if (categoryFilter.value === 'ALL') return []
  return [...new Set(allCourseOptions.value.filter(o => o.category === categoryFilter.value && o.subcategory).map(o => o.subcategory))].sort()
})
function onCategoryFilterChange() { subcategoryFilter.value = 'ALL'; selectedCourseKey.value = ''; resourceSource.value = '' }
function onSubcategoryFilterChange() { selectedCourseKey.value = ''; resourceSource.value = '' }

const filteredCourseOptions = computed(() => {
  let list = allCourseOptions.value
  if (categoryFilter.value !== 'ALL') list = list.filter(o => o.category === categoryFilter.value)
  if (subcategoryFilter.value !== 'ALL') list = list.filter(o => o.subcategory === subcategoryFilter.value)
  return list
})

function onCourseSelect() {
  const opt = allCourseOptions.value.find(o => o.key === selectedCourseKey.value)
  if (!opt) { resourceSource.value = ''; return }
  topicLabel.value = opt.sourceType === 'resource' ? opt.label : opt.subcategory
  resourceSource.value = opt.sourceType === 'resource' ? opt.sourceValue : ''
}

async function refreshActiveQuiz() {
  try {
    const data = await api.getActiveQuiz(outlet)
    activeQuiz.value = data.active ? data : null
  } catch (e) { activeQuiz.value = null }
}

function startCountdown() {
  if (timerHandle) clearInterval(timerHandle)
  const tick = () => {
    if (!activeQuiz.value) { remaining.value = ''; return }
    const expiresAt = new Date(activeQuiz.value.createdAt).getTime() + 60 * 60 * 1000
    const ms = expiresAt - Date.now()
    if (ms <= 0) { remaining.value = t('outletManagerDashboard.expired'); activeQuiz.value = null; return }
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    remaining.value = `${mins}:${secs.toString().padStart(2, '0')}`
  }
  tick()
  timerHandle = setInterval(tick, 1000)
}

onMounted(async () => {
  await refreshActiveQuiz()
  startCountdown()
  try {
    await loadCourseOptions()
  } catch (e) { /* leave dropdown empty */ }
  // Arrived from Browse Courses' "Create Quiz" button.
  if (route.query.sourceType === 'resource' && route.query.sourceValue) {
    resourceSource.value = route.query.sourceValue.toString()
    topicLabel.value = (route.query.topicLabel || '').toString()
    selectedCourseKey.value = 'resource::' + resourceSource.value
    // Reflect the picked item in the two filters too, so the cascade
    // shows where it actually lives instead of sitting at "All".
    const matched = allCourseOptions.value.find(o => o.key === selectedCourseKey.value)
    if (matched) { categoryFilter.value = matched.category || 'ALL'; subcategoryFilter.value = matched.subcategory || 'ALL' }
  } else if (route.query.topic) {
    // Knowledge hand-off only carries a topic string, not a specific
    // content id, so there's no single option key to preselect here —
    // just fill the topic field, leave the filters at their defaults.
    topicLabel.value = route.query.topic.toString()
  }
})

onUnmounted(() => { if (timerHandle) clearInterval(timerHandle) })

async function createQuiz() {
  createError.value = ''
  if (!topicLabel.value.trim()) {
    createError.value = t('outletManagerDashboard.errorEnterTopic')
    return
  }
  creating.value = true
  try {
    const data = await api.createAiQuiz({
      outlet,
      sourceType: resourceSource.value ? 'resource' : 'topic',
      sourceValue: resourceSource.value || topicLabel.value.trim(),
      topicLabel: topicLabel.value.trim(),
      count: count.value,
      extraNotes: extraNotes.value.trim(),
      manager: managerLabel,
    })
    activeQuiz.value = data
    startCountdown()
    topicLabel.value = ''
    extraNotes.value = ''
    clearResourceSource()
  } catch (err) {
    createError.value = err.message || t('outletManagerDashboard.errorGenerateFailed')
  } finally {
    creating.value = false
  }
}

async function endQuiz() {
  if (!confirm(t('outletManagerDashboard.confirmEndQuiz'))) return
  try {
    await api.endQuiz(outlet)
  } catch (e) { /* best-effort */ }
  if (timerHandle) clearInterval(timerHandle)
  activeQuiz.value = null
}

</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleOutletManager') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ outlet }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8 space-y-10">
      <section>
        <h2 class="font-display text-lg font-semibold text-ink mb-4">{{ t('outletManagerDashboard.aiPracticeQuiz') }}</h2>

        <div v-if="activeQuiz" class="bg-white rounded-xl2 p-5 shadow-sm mb-4">
          <p class="text-xs text-slate uppercase tracking-wide">{{ t('outletManagerDashboard.activeCode') }}</p>
          <p class="font-display text-3xl font-bold text-aqua tracking-[0.3em]">{{ activeQuiz.passcode }}</p>
          <p class="text-sm text-ink mt-1">{{ t('outletManagerDashboard.quizSummary', { topic: activeQuiz.topic, count: activeQuiz.count }) }}</p>
          <p class="text-xs text-slate mt-1">{{ t('outletManagerDashboard.expiresIn', { remaining }) }}</p>
          <button @click="endQuiz" class="mt-3 text-coral text-xs font-medium underline">{{ t('outletManagerDashboard.endCodeNow') }}</button>
        </div>

        <form v-if="!auth.impersonating" @submit.prevent="createQuiz" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <div v-if="resourceSource" class="bg-aqualight/40 border border-aqua/30 rounded-lg p-3 text-sm text-deepsea flex items-center justify-between gap-3">
            <span>{{ t('outletManagerDashboard.sourcedFromCourse') }}</span>
            <button type="button" @click="clearResourceSource" class="text-aqua font-medium underline shrink-0">{{ t('outletManagerDashboard.useTopicInstead') }}</button>
          </div>
          <div v-if="allCourseOptions.length">
            <label class="block text-sm font-medium text-ink mb-1">{{ t('outletManagerDashboard.pickCourseOptional') }}</label>
            <div class="grid grid-cols-2 gap-2 mb-2">
              <select v-model="categoryFilter" @change="onCategoryFilterChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
                <option value="ALL">{{ t('outletManagerDashboard.allCategories') }}</option>
                <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
              </select>
              <select v-if="subcategories.length" v-model="subcategoryFilter" @change="onSubcategoryFilterChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
                <option value="ALL">{{ t('outletManagerDashboard.allTopics') }}</option>
                <option v-for="s in subcategories" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <select v-model="selectedCourseKey" @change="onCourseSelect" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="">{{ t('outletManagerDashboard.orTypeTopicBelow') }}</option>
              <option v-for="o in filteredCourseOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('outletManagerDashboard.topicLabel') }}</label>
            <input v-model="topicLabel" @input="clearResourceSource" type="text" :placeholder="t('outletManagerDashboard.topicPlaceholder')"
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('outletManagerDashboard.notesLabel') }}</label>
            <input v-model="extraNotes" type="text" :placeholder="t('outletManagerDashboard.notesPlaceholder')"
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('outletManagerDashboard.questionCountLabel') }}</label>
            <input v-model.number="count" type="number" min="1" max="25"
              class="w-24 border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <p v-if="createError" class="text-coral text-sm">{{ createError }}</p>
          <button type="submit" :disabled="creating"
            class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
            {{ creating ? t('outletManagerDashboard.generating') : (activeQuiz ? t('outletManagerDashboard.replaceCode') : t('outletManagerDashboard.generateCode')) }}
          </button>
        </form>
        <p v-else class="text-slate text-sm bg-white rounded-xl2 p-5 shadow-sm">{{ t('outletManagerDashboard.impersonatingNotice') }}</p>
      </section>
    </main>
  </div>
</template>
