<script setup>
// Split out of OutletManagerDashboard.vue — Staff Results was a section on
// the same page as Create Quiz/Manage Staff, but the sidebar nav treats it
// as its own destination.
//
// Module Quiz and AI Practice shown as two separate sections, not merged
// (same reasoning as staff's QuizHistoryView.vue) — plus wrong-answer
// review per attempt, which this page never had. Module Quiz matches wrong
// answers by AttemptID, same approach as QuizHistoryView.vue and
// AreaManagerDashboard.vue: rows saved after the attempt_id migration (see
// backend migrate-add-attempt-id.js) get exact per-attempt matching; older
// rows predating it have no AttemptID on either side, so those fall back
// to the old name+topic match instead of silently showing nothing. AI
// Practice matches by the real AttemptID, exact per-attempt.
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { videoHoursByTopic, contentHoursByTopic, hoursByStaff, splitByVideoTopic, splitByContentTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'
import PharmacistComplianceMatrix from '../components/PharmacistComplianceMatrix.vue'

const auth = useAuthStore()
const outlet = auth.manager?.outlet
const { t, locale } = useI18n()

// Wrong-answer fields come back as separate En/Ms columns (data.js's
// toResponse) so this re-renders in whichever language is currently
// active. Falls back to En when Ms is null (rows saved before the
// wrong_answers bilingual migration).
function bilingual(w, field) {
  return (locale.value === 'ms' && w[`${field} Ms`]) || w[`${field} En`]
}

const standardHistory = ref([])
const aiHistory = ref([])
const wrongAnswers = ref([])
const aiWrongAnswers = ref([])
const videoTrainings = ref([])
const contentEntries = ref([])
const loading = ref(true)

const videoYear = ref('ALL')
const videoTopic = ref('ALL')
const videoStaff = ref('ALL')
const standardYear = ref('ALL')
const standardTopic = ref('ALL')
const standardStaff = ref('ALL')
const eLearningYear = ref('ALL')
const eLearningTopic = ref('ALL')
const eLearningStaff = ref('ALL')
const aiYear = ref('ALL')
const aiTopic = ref('ALL')
const aiStaff = ref('ALL')
const cpdYear = ref(new Date().getFullYear())

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

// standardHistory carries every Video Training + Module Quiz result for
// this outlet (both write into the same results table, distinguished only
// by which topic namespace they belong to) — split once here, both
// sections below read from this.
const splitStandard = computed(() => splitByVideoTopic(standardHistory.value, videoHoursByTopic(videoTrainings.value)))
const videoTrainingHistory = computed(() => splitStandard.value.video)
// splitStandard.moduleQuiz still mixes true Module Quiz with Content quiz
// (eLearning) attempts — same topic namespace, only contentHoursByTopic
// tells them apart. Second pass here pulls eLearning out into its own
// section instead of leaving it mislabeled as Module Quiz.
const splitNonVideo = computed(() => splitByContentTopic(splitStandard.value.moduleQuiz, contentHoursByTopic(contentEntries.value)))
const moduleQuizHistory = computed(() => splitNonVideo.value.moduleQuiz)
const eLearningHistory = computed(() => splitNonVideo.value.content)

const videoYears = computed(() => [...new Set(videoTrainingHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const videoTopics = computed(() => [...new Set(videoTrainingHistory.value.map((h) => h.Topic))].sort())
const videoStaffNames = computed(() => [...new Set(videoTrainingHistory.value.map((h) => h.Name))].sort())
const filteredVideoHistory = computed(() => videoTrainingHistory.value.filter((h) => {
  if (videoYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== videoYear.value) return false
  if (videoTopic.value !== 'ALL' && h.Topic !== videoTopic.value) return false
  if (videoStaff.value !== 'ALL' && h.Name !== videoStaff.value) return false
  return true
}))

const standardYears = computed(() => [...new Set(moduleQuizHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const standardTopics = computed(() => [...new Set(moduleQuizHistory.value.map((h) => h.Topic))].sort())
const standardStaffNames = computed(() => [...new Set(moduleQuizHistory.value.map((h) => h.Name))].sort())
const filteredStandardHistory = computed(() => moduleQuizHistory.value.filter((h) => {
  if (standardYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== standardYear.value) return false
  if (standardTopic.value !== 'ALL' && h.Topic !== standardTopic.value) return false
  if (standardStaff.value !== 'ALL' && h.Name !== standardStaff.value) return false
  return true
}))

const eLearningYears = computed(() => [...new Set(eLearningHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const eLearningTopics = computed(() => [...new Set(eLearningHistory.value.map((h) => h.Topic))].sort())
const eLearningStaffNames = computed(() => [...new Set(eLearningHistory.value.map((h) => h.Name))].sort())
const filteredELearningHistory = computed(() => eLearningHistory.value.filter((h) => {
  if (eLearningYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== eLearningYear.value) return false
  if (eLearningTopic.value !== 'ALL' && h.Topic !== eLearningTopic.value) return false
  if (eLearningStaff.value !== 'ALL' && h.Name !== eLearningStaff.value) return false
  return true
}))

const aiYears = computed(() => [...new Set(aiHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))
const aiTopics = computed(() => [...new Set(aiHistory.value.map((h) => h.Topic))].sort())
const aiStaffNames = computed(() => [...new Set(aiHistory.value.map((h) => h.Name))].sort())
const filteredAiHistory = computed(() => aiHistory.value.filter((h) => {
  if (aiYear.value !== 'ALL' && new Date(h.Timestamp).getFullYear() !== aiYear.value) return false
  if (aiTopic.value !== 'ALL' && h.Topic !== aiTopic.value) return false
  if (aiStaff.value !== 'ALL' && h.Name !== aiStaff.value) return false
  return true
}))

// CPD year dropdown always offers the current year even with zero data yet,
// plus any year real attempts exist for — no "ALL" option, CPD is
// inherently per-calendar-year (see plan's Global Constraints).
const cpdYears = computed(() => {
  const years = new Set([...standardHistory.value, ...aiHistory.value].map((h) => new Date(h.Timestamp).getFullYear()))
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
})

onMounted(async () => {
  try {
    const [data, videos, content] = await Promise.all([api.getScopedData(), api.getVideoTrainings(), api.getContent()])
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

// standardHistory already carries every Video Training + Module Quiz
// result for this outlet (both write into the same results table,
// distinguished only by which topic namespace they belong to); aiHistory
// carries every AI Practice result. hoursByStaff() handles the
// video-vs-module split internally via hoursByTopic.
const cpdSummary = computed(() => hoursByStaff(standardHistory.value, aiHistory.value, videoHoursByTopic(videoTrainings.value), contentHoursByTopic(contentEntries.value), cpdYear.value))
const { currentPage: cpdCurrentPage, totalPages: cpdTotalPages, paginatedItems: paginatedCpdSummary, next: cpdNext, prev: cpdPrev } = usePagination(cpdSummary)
const { currentPage: videoCurrentPage, totalPages: videoTotalPages, paginatedItems: paginatedVideoHistory, next: videoNext, prev: videoPrev } = usePagination(filteredVideoHistory)
const { currentPage: standardCurrentPage, totalPages: standardTotalPages, paginatedItems: paginatedStandardHistory, next: standardNext, prev: standardPrev } = usePagination(filteredStandardHistory)
const { currentPage: eLearningCurrentPage, totalPages: eLearningTotalPages, paginatedItems: paginatedELearningHistory, next: eLearningNext, prev: eLearningPrev } = usePagination(filteredELearningHistory)
const { currentPage: aiCurrentPage, totalPages: aiTotalPages, paginatedItems: paginatedAiHistory, next: aiNext, prev: aiPrev } = usePagination(filteredAiHistory)

function wrongsForStandard(h) {
  if (h.AttemptID) return wrongAnswers.value.filter((w) => w.AttemptID === h.AttemptID)
  return wrongAnswers.value.filter((w) => !w.AttemptID && w['Staff Name'] === h.Name && w.Topic === h.Topic)
}
function wrongsForAi(attemptId) {
  return aiWrongAnswers.value.filter((w) => w.AttemptID === attemptId)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleOutletManager') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('outletManagerResultsView.title', { outlet }) }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('outletManagerResultsView.loading') }}</div>

      <template v-else>
        <section class="mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('outletManagerResultsView.cpdHeading') }}</h2>
            <select v-model.number="cpdYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option v-for="y in cpdYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="cpdSummary.length" class="bg-white rounded-xl2 divide-y divide-seafoam">
            <div v-for="s in paginatedCpdSummary" :key="s.name" class="px-5 py-3 flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
              <span class="text-sm font-display font-semibold shrink-0" :class="s.hours >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
                {{ t('outletManagerResultsView.cpdHoursOfTarget', { hours: s.hours, target: CPD_TARGET_HOURS }) }}
              </span>
            </div>
            <Pagination :current-page="cpdCurrentPage" :total-pages="cpdTotalPages" @prev="cpdPrev" @next="cpdNext" />
          </div>
          <div v-else class="bg-white rounded-xl2 px-5 py-4">
            <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</p>
          </div>
        </section>

        <PharmacistComplianceMatrix />

        <section>
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.videoTrainingHeading') }}</h2>
          <div v-if="videoTrainingHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="videoYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in videoYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="videoTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in videoTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
              <select v-model="videoStaff" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allStaff') }}</option>
                <option v-for="n in videoStaffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div v-if="filteredVideoHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in paginatedVideoHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3">
                <summary class="flex items-center gap-3 cursor-pointer">
                  <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                    <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                    <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
                  </div>
                  <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                    {{ h.Score }}
                  </span>
                </summary>
                <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: bilingual(w, 'Question Text') }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: bilingual(w, 'Correct Answer') }) }}</p>
                  </div>
                </div>
              </details>
              <Pagination :current-page="videoCurrentPage" :total-pages="videoTotalPages" @prev="videoPrev" @next="videoNext" />
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.moduleQuizHeading') }}</h2>
          <div v-if="moduleQuizHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="standardTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in standardTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
              <select v-model="standardStaff" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allStaff') }}</option>
                <option v-for="n in standardStaffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div v-if="filteredStandardHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in paginatedStandardHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3">
                <summary class="flex items-center gap-3 cursor-pointer">
                  <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                    <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                    <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
                  </div>
                  <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                    {{ h.Score }}
                  </span>
                </summary>
                <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: bilingual(w, 'Question Text') }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: bilingual(w, 'Correct Answer') }) }}</p>
                  </div>
                </div>
              </details>
              <Pagination :current-page="standardCurrentPage" :total-pages="standardTotalPages" @prev="standardPrev" @next="standardNext" />
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.eLearningHeading') }}</h2>
          <div v-if="eLearningHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="eLearningYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in eLearningYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="eLearningTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in eLearningTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
              <select v-model="eLearningStaff" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allStaff') }}</option>
                <option v-for="n in eLearningStaffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div v-if="filteredELearningHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in paginatedELearningHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3">
                <summary class="flex items-center gap-3 cursor-pointer">
                  <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                    <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                    <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
                  </div>
                  <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                    {{ h.Score }}
                  </span>
                </summary>
                <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: bilingual(w, 'Question Text') }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: bilingual(w, 'Correct Answer') }) }}</p>
                  </div>
                </div>
              </details>
              <Pagination :current-page="eLearningCurrentPage" :total-pages="eLearningTotalPages" @prev="eLearningPrev" @next="eLearningNext" />
            </div>
          </template>
        </section>

        <section class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('outletManagerResultsView.aiPracticeHeading') }}</h2>
          <div v-if="aiHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsYet') }}</div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allYears') }}</option>
                <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="aiTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allTopics') }}</option>
                <option v-for="t2 in aiTopics" :key="t2" :value="t2">{{ t2 }}</option>
              </select>
              <select v-model="aiStaff" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white min-w-0">
                <option value="ALL">{{ t('outletManagerResultsView.allStaff') }}</option>
                <option v-for="n in aiStaffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div v-if="filteredAiHistory.length === 0" class="text-slate text-sm">{{ t('outletManagerResultsView.noAttemptsFiltered') }}</div>
            <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
              <details v-for="h in paginatedAiHistory" :key="h.AttemptID" class="px-5 py-3">
                <summary class="flex items-center gap-3 cursor-pointer">
                  <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                    <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(h.Timestamp).month }}</p>
                    <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(h.Timestamp).day }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-ink truncate">{{ h.Name }} · {{ h.Topic }}</p>
                  </div>
                  <span class="text-sm font-display font-semibold shrink-0" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
                    {{ h.Score }}
                  </span>
                </summary>
                <div v-if="wrongsForAi(h.AttemptID).length" class="mt-3 space-y-2">
                  <div v-for="(w, j) in wrongsForAi(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                    <p class="text-xs font-medium text-coral">{{ t('outletManagerResultsView.questionPrefix', { text: bilingual(w, 'Question Text') }) }}</p>
                    <p class="text-xs text-aqua font-semibold mt-1">{{ t('outletManagerResultsView.correctLabel', { text: bilingual(w, 'Correct Answer') }) }}</p>
                  </div>
                </div>
              </details>
              <Pagination :current-page="aiCurrentPage" :total-pages="aiTotalPages" @prev="aiPrev" @next="aiNext" />
            </div>
          </template>
        </section>
      </template>
    </main>
  </div>
</template>
