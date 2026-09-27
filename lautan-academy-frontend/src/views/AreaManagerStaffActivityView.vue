<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { useAreaStaffActivity } from '../composables/useStaffActivity'
import { api } from '../api/client'

const auth = useAuthStore()
const { t } = useI18n()
const { loading, outletActivity, activeOutletCount, totalOutletCount, ACTIVE_WINDOW_DAYS } = useAreaStaffActivity(auth.manager?.outlets || [])

// AI Practice Quiz creation, same logic as OutletManagerDashboard.vue's
// generateCode flow, extended with an outlet picker — area_manager's scope
// is the whole region (see outletsForArea on the backend), so which outlet
// a code is generated for is a form choice here instead of implicit.
const regionOutlets = auth.manager?.outlets || []
const managerLabel = auth.manager?.label || 'Area Manager'
const quizOutlet = ref(regionOutlets[0] || '')
const quizTopicLabel = ref('')
const quizExtraNotes = ref('')
const quizCount = ref(10)
const quizCreating = ref(false)
const quizCreateError = ref('')
const quizResourceSource = ref('') // Drive file id, set only via the course picker below
const quizSelectedCourseKey = ref('')
function clearQuizResourceSource() { quizResourceSource.value = ''; quizSelectedCourseKey.value = '' }

const activeQuiz = ref(null) // { passcode, topic, count, createdAt }
const quizRemaining = ref('')
let quizTimerHandle = null

// Same category/subcategory shape Browse Courses itself uses — see
// OutletManagerDashboard.vue for the full rationale. label falls back to
// Topic when Title is blank (content added from the app with no Title
// filled in) — Browse Courses itself already does this (ResourcesView.vue),
// this list just hadn't matched it, so a Title-less entry rendered as a
// blank row here even though it was still selectable.
const allCourseOptions = ref([])
async function loadCourseOptions() {
  const [contentResult, resourcesResult] = await Promise.allSettled([api.getContent(), api.getResources()])
  const opts = []
  if (contentResult.status === 'fulfilled') {
    for (const c of (contentResult.value.content || [])) {
      opts.push({ key: 'topic::' + c.ID, label: c.Title || c.Topic, category: c.Category, subcategory: c.Topic, sourceType: 'topic', sourceValue: c.Topic })
    }
  }
  if (resourcesResult.status === 'fulfilled') {
    for (const r of (resourcesResult.value.referenceDocs || [])) {
      opts.push({ key: 'resource::' + r.ID, label: r.Name, category: r.Category, subcategory: r.Subcategory, sourceType: 'resource', sourceValue: r.ID })
    }
  }
  allCourseOptions.value = opts
}

const quizCategoryFilter = ref('ALL')
const quizSubcategoryFilter = ref('ALL')
const quizCategories = computed(() => [...new Set(allCourseOptions.value.map(o => o.category).filter(Boolean))].sort())
const quizSubcategories = computed(() => {
  if (quizCategoryFilter.value === 'ALL') return []
  return [...new Set(allCourseOptions.value.filter(o => o.category === quizCategoryFilter.value && o.subcategory).map(o => o.subcategory))].sort()
})
function onQuizCategoryFilterChange() { quizSubcategoryFilter.value = 'ALL'; quizSelectedCourseKey.value = ''; quizResourceSource.value = '' }
function onQuizSubcategoryFilterChange() { quizSelectedCourseKey.value = ''; quizResourceSource.value = '' }

const filteredQuizCourseOptions = computed(() => {
  let list = allCourseOptions.value
  if (quizCategoryFilter.value !== 'ALL') list = list.filter(o => o.category === quizCategoryFilter.value)
  if (quizSubcategoryFilter.value !== 'ALL') list = list.filter(o => o.subcategory === quizSubcategoryFilter.value)
  return list
})

function onQuizCourseSelect() {
  const opt = allCourseOptions.value.find(o => o.key === quizSelectedCourseKey.value)
  if (!opt) { quizResourceSource.value = ''; return }
  quizTopicLabel.value = opt.sourceType === 'resource' ? opt.label : opt.subcategory
  quizResourceSource.value = opt.sourceType === 'resource' ? opt.sourceValue : ''
}

async function refreshActiveQuiz() {
  if (!quizOutlet.value) { activeQuiz.value = null; return }
  try {
    const data = await api.getActiveQuiz(quizOutlet.value)
    activeQuiz.value = data.active ? data : null
  } catch (e) { activeQuiz.value = null }
}

function startQuizCountdown() {
  if (quizTimerHandle) clearInterval(quizTimerHandle)
  const tick = () => {
    if (!activeQuiz.value) { quizRemaining.value = ''; return }
    const expiresAt = new Date(activeQuiz.value.createdAt).getTime() + 60 * 60 * 1000
    const ms = expiresAt - Date.now()
    if (ms <= 0) { quizRemaining.value = t('areaStaffActivityView.quizExpired'); activeQuiz.value = null; return }
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    quizRemaining.value = `${mins}:${secs.toString().padStart(2, '0')}`
  }
  tick()
  quizTimerHandle = setInterval(tick, 1000)
}

// Switching which outlet the code is for means the active-code panel above
// must reflect THAT outlet's code, not whichever was showing before.
watch(quizOutlet, async () => {
  await refreshActiveQuiz()
  startQuizCountdown()
})

async function createQuiz() {
  quizCreateError.value = ''
  if (!quizOutlet.value) {
    quizCreateError.value = t('areaStaffActivityView.errorSelectQuizOutlet')
    return
  }
  if (!quizTopicLabel.value.trim()) {
    quizCreateError.value = t('areaStaffActivityView.errorEnterTopic')
    return
  }
  quizCreating.value = true
  try {
    const data = await api.createAiQuiz({
      outlet: quizOutlet.value,
      sourceType: quizResourceSource.value ? 'resource' : 'topic',
      sourceValue: quizResourceSource.value || quizTopicLabel.value.trim(),
      topicLabel: quizTopicLabel.value.trim(),
      count: quizCount.value,
      extraNotes: quizExtraNotes.value.trim(),
      manager: managerLabel,
    })
    activeQuiz.value = data
    startQuizCountdown()
    quizTopicLabel.value = ''
    quizExtraNotes.value = ''
    clearQuizResourceSource()
  } catch (err) {
    quizCreateError.value = err.message || t('areaStaffActivityView.errorGenerateFailed')
  } finally {
    quizCreating.value = false
  }
}

async function endQuiz() {
  if (!confirm(t('areaStaffActivityView.confirmEndQuiz'))) return
  try { await api.endQuiz(quizOutlet.value) } catch (e) { /* best-effort */ }
  if (quizTimerHandle) clearInterval(quizTimerHandle)
  activeQuiz.value = null
}

onMounted(async () => {
  await refreshActiveQuiz()
  startQuizCountdown()
  try {
    await loadCourseOptions()
  } catch (e) { /* leave dropdown empty */ }
})

onUnmounted(() => { if (quizTimerHandle) clearInterval(quizTimerHandle) })
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleAreaManager') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('areaStaffActivityView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <section class="mb-10">
        <h2 class="font-display text-lg font-semibold text-ink mb-4">{{ t('areaStaffActivityView.aiPracticeQuiz') }}</h2>

        <div class="mb-3">
          <label class="block text-sm font-medium text-ink mb-1">{{ t('areaStaffActivityView.quizOutletLabel') }}</label>
          <select v-model="quizOutlet" class="w-full border border-slate/30 rounded-lg py-2 px-3 bg-white">
            <option v-for="o in regionOutlets" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <div v-if="activeQuiz" class="bg-white rounded-xl2 p-5 shadow-sm mb-4">
          <p class="text-xs text-slate uppercase tracking-wide">{{ t('areaStaffActivityView.activeCode') }}</p>
          <p class="font-display text-3xl font-bold text-aqua tracking-[0.3em]">{{ activeQuiz.passcode }}</p>
          <p class="text-sm text-ink mt-1">{{ t('areaStaffActivityView.quizSummary', { topic: activeQuiz.topic, count: activeQuiz.count }) }}</p>
          <p class="text-xs text-slate mt-1">{{ t('areaStaffActivityView.expiresIn', { remaining: quizRemaining }) }}</p>
          <button @click="endQuiz" class="mt-3 text-coral text-xs font-medium underline">{{ t('areaStaffActivityView.endCodeNow') }}</button>
        </div>

        <form v-if="!auth.impersonating" @submit.prevent="createQuiz" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <div v-if="allCourseOptions.length">
            <label class="block text-sm font-medium text-ink mb-1">{{ t('areaStaffActivityView.pickTopicFromCourse') }}</label>
            <div class="grid grid-cols-2 gap-2 mb-2">
              <select v-model="quizCategoryFilter" @change="onQuizCategoryFilterChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
                <option value="ALL">{{ t('areaStaffActivityView.allCategories') }}</option>
                <option v-for="c in quizCategories" :key="c" :value="c">{{ c }}</option>
              </select>
              <select v-if="quizSubcategories.length" v-model="quizSubcategoryFilter" @change="onQuizSubcategoryFilterChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
                <option value="ALL">{{ t('areaStaffActivityView.allTopics') }}</option>
                <option v-for="s in quizSubcategories" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <select v-model="quizSelectedCourseKey" @change="onQuizCourseSelect" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="">{{ t('areaStaffActivityView.orTypeTopicBelow') }}</option>
              <option v-for="o in filteredQuizCourseOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
            </select>
          </div>
          <!-- Once a course is picked, its name already shows in the select
               above — repeating it in an editable Topic field below read as
               the same topic shown twice. Collapse to one line instead, with
               an escape hatch back to free-text entry. -->
          <div v-if="quizSelectedCourseKey" class="bg-aqualight/40 border border-aqua/30 rounded-lg p-3 text-sm text-deepsea flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium truncate">{{ quizTopicLabel }}</p>
              <p v-if="quizResourceSource" class="text-xs text-deepsea/70 mt-0.5">{{ t('areaStaffActivityView.sourcedFromCourse') }}</p>
            </div>
            <button type="button" @click="clearQuizResourceSource" class="text-aqua font-medium underline shrink-0">{{ t('areaStaffActivityView.useTopicInstead') }}</button>
          </div>
          <div v-else>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('areaStaffActivityView.topicLabel') }}</label>
            <input v-model="quizTopicLabel" type="text" :placeholder="t('areaStaffActivityView.topicPlaceholder')"
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('areaStaffActivityView.notesLabel') }}</label>
            <input v-model="quizExtraNotes" type="text" :placeholder="t('areaStaffActivityView.notesPlaceholder')"
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('areaStaffActivityView.questionCountLabel') }}</label>
            <input v-model.number="quizCount" type="number" min="1" max="25"
              class="w-24 border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <p v-if="quizCreateError" class="text-coral text-sm">{{ quizCreateError }}</p>
          <button type="submit" :disabled="quizCreating"
            class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
            {{ quizCreating ? t('areaStaffActivityView.generating') : (activeQuiz ? t('areaStaffActivityView.replaceCode') : t('areaStaffActivityView.generateCode')) }}
          </button>
        </form>
        <p v-else class="text-slate text-sm bg-white rounded-xl2 p-5 shadow-sm">{{ t('areaStaffActivityView.impersonatingNotice') }}</p>
      </section>

      <p class="text-slate text-sm mb-6">{{ t('areaStaffActivityView.summary', { active: activeOutletCount, total: totalOutletCount, days: ACTIVE_WINDOW_DAYS }) }}</p>

      <div v-if="loading" class="text-slate text-sm">{{ t('areaStaffActivityView.loading') }}</div>
      <div v-else-if="!outletActivity.length" class="bg-white rounded-xl2 px-5 py-4">
        <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('areaStaffActivityView.noOutlets') }}</p>
      </div>
      <div v-else class="space-y-3">
        <details v-for="o in outletActivity" :key="o.outlet" class="bg-white rounded-xl2 shadow-sm">
          <summary class="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer">
            <p class="text-sm font-display font-semibold text-ink">{{ o.outlet }}</p>
            <span class="text-xs font-display font-semibold shrink-0 px-2 py-1 rounded-full" :class="o.activeCount > 0 ? 'bg-aqualight text-deepsea' : 'bg-coral/10 text-coral'">
              {{ t('areaStaffActivityView.staffCountRatio', { active: o.activeCount, total: o.totalCount }) }}
            </span>
          </summary>
          <div v-if="!o.staff.length" class="px-5 pb-4">
            <p class="text-slate text-xs">{{ t('areaStaffActivityView.noStaffInOutlet') }}</p>
          </div>
          <div v-else class="border-t border-seafoam divide-y divide-seafoam">
            <div v-for="s in o.staff" :key="s.name" class="px-5 py-3 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
                <p class="text-xs text-slate">{{ s.lastAttempt ? t('staffActivityView.lastActive', { date: new Date(s.lastAttempt).toLocaleDateString() }) : t('staffActivityView.noActivityYet') }}</p>
              </div>
              <span class="text-xs font-display font-semibold shrink-0 px-2 py-1 rounded-full" :class="s.active ? 'bg-aqualight text-deepsea' : 'bg-coral/10 text-coral'">
                {{ s.active ? t('staffActivityView.active') : t('staffActivityView.inactive') }}
              </span>
            </div>
          </div>
        </details>
      </div>
    </main>
  </div>
</template>
