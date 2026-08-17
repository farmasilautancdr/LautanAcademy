<script setup>
// Split out of DashboardView.vue — was a section on the same page as My
// Learning/Resources, but the sidebar nav treats it as its own destination,
// so it needs to actually be one.
//
// Module Quiz (Standard) and AI Practice are kept as two separate sections,
// not merged into one list — different data sources, different rules
// (Module Quiz result rows have no shared attempt id, so wrong-answer
// review below matches by topic only; a topic retaken on a different day
// will show wrong answers from every attempt of that topic together, not
// just the one being expanded — a pre-existing schema limitation, same one
// AreaManagerDashboard.vue already has. AI Practice rows have a real
// AttemptID, so that review is exact per-attempt.
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, MODULE_QUIZ_HOURS, AI_PRACTICE_HOURS, CPD_TARGET_HOURS } from '../composables/useCpdHours'
import { usePagination } from '../composables/usePagination'
import ProgressRing from '../components/ProgressRing.vue'
import Pagination from '../components/Pagination.vue'

const { t, locale } = useI18n()

// Wrong-answer fields come back as separate En/Ms columns (see
// data.js's toResponse) so history re-renders in whichever language is
// currently active, not whatever language was active when the quiz was
// taken. Falls back to En when Ms is null — true for rows saved before
// the wrong_answers/ai_wrong_answers bilingual migration.
function bilingual(w, field) {
  return (locale.value === 'ms' && w[`${field} Ms`]) || w[`${field} En`]
}
const standardHistory = ref([])
const aiHistory = ref([])
const wrongAnswers = ref([])
const aiWrongAnswers = ref([])
const reports = ref([])
const videoTrainings = ref([])
const loading = ref(true)
const auth = useAuthStore()

const reportYear = ref('ALL')
const reportTopic = ref('ALL')
const videoYear = ref('ALL')
const standardYear = ref('ALL')
const aiYear = ref('ALL')
const cpdYear = ref(new Date().getFullYear())

onMounted(async () => {
  try {
    const [data, videos] = await Promise.all([
      api.getScopedData(),
      api.getVideoTrainings().catch(() => ({ videoTrainings: [] })),
    ])
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false
})

// standardHistory carries every Video Training + Module Quiz result for
// this staff member (both write into the same results table, distinguished
// only by topic membership) — split once here, both sections below read
// from this.
const splitStandard = computed(() => splitByVideoTopic(standardHistory.value, videoHoursByTopic(videoTrainings.value)))
const videoTrainingHistory = computed(() => splitStandard.value.video)
const moduleQuizHistory = computed(() => splitStandard.value.moduleQuiz)

const filteredVideoHistory = computed(() => videoYear.value === 'ALL' ? videoTrainingHistory.value : videoTrainingHistory.value.filter((h) => new Date(h.Timestamp).getFullYear() === videoYear.value))
const videoYears = computed(() => [...new Set(videoTrainingHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))

const filteredStandardHistory = computed(() => standardYear.value === 'ALL' ? moduleQuizHistory.value : moduleQuizHistory.value.filter((h) => new Date(h.Timestamp).getFullYear() === standardYear.value))
const standardYears = computed(() => [...new Set(moduleQuizHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))

const filteredAiHistory = computed(() => aiYear.value === 'ALL' ? aiHistory.value : aiHistory.value.filter((h) => new Date(h.Timestamp).getFullYear() === aiYear.value))
const aiYears = computed(() => [...new Set(aiHistory.value.map((h) => new Date(h.Timestamp).getFullYear()))].sort((a, b) => b - a))

// CPD year dropdown always offers the current year even with zero data
// yet, plus any year real attempts exist for — no "ALL" option.
const cpdYears = computed(() => {
  const years = new Set([...standardHistory.value, ...aiHistory.value].map((h) => new Date(h.Timestamp).getFullYear()))
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
})
// Single-staff variant of the manager views' cpdSummary — hoursByStaff()
// still returns an array grouped by name+outlet, so a staff member with
// historical rows under more than one outlet (transfers) produces more
// than one entry; sum instead of indexing [0] so none of it is dropped.
// Client-side equivalent of DashboardView.vue's server-computed
// cpdHoursThisYear (current year only there) — this one supports picking
// past years via cpdYear, which the backend field doesn't provide. Keep
// the underlying rate logic (hoursByStaff/videoHoursByTopic) in sync with
// the backend's cpdHoursThisYear() helper in data.js if either ever changes.
const cpdHoursThisYear = computed(() => hoursByStaff(standardHistory.value, aiHistory.value, videoHoursByTopic(videoTrainings.value), cpdYear.value).reduce((sum, e) => sum + e.hours, 0))

// Pharmacist self-export — a permanent personal record that survives
// Annual Data Reset purging old `results` rows. All-time, not scoped to
// cpdYear (the point is an archive, not a snapshot of one year). See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
function csvEscape(value) {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function downloadTrainingRecordCsv() {
  const hoursByTopic = videoHoursByTopic(videoTrainings.value)
  const rows = [
    ...standardHistory.value.map((h) => ({
      topic: h.Topic,
      date: h.Timestamp,
      hours: hoursByTopic.has(h.Topic) ? hoursByTopic.get(h.Topic) : MODULE_QUIZ_HOURS,
    })),
    ...aiHistory.value.map((h) => ({
      topic: h.Topic,
      date: h.Timestamp,
      hours: AI_PRACTICE_HOURS,
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date))

  const header = ['Topic', 'Date', 'Hours'].map(csvEscape).join(',')
  const body = rows.map((r) => [r.topic, new Date(r.date).toISOString().slice(0, 10), r.hours].map(csvEscape).join(','))
  const total = rows.reduce((sum, r) => sum + r.hours, 0)
  const footer = ['Total', '', total].map(csvEscape).join(',')

  const blob = new Blob(['﻿' + [header, ...body, footer].join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cpd-record-${auth.staff?.name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Same thresholds AreaManagerReviewsView uses to compute the badge when
// filing — reports store the label already, this just picks its color.
function skillLevelColor(level) {
  if (level === 'HIGH') return 'text-aqua'
  if (level === 'LOW') return 'text-coral'
  return 'text-ink'
}

const reportYears = computed(() => [...new Set(reports.value.map((r) => new Date(r.Timestamp).getFullYear()))].sort((a, b) => b - a))
const reportTopics = computed(() => [...new Set(reports.value.map((r) => r['Training Title']))].sort())

const filteredReports = computed(() => reports.value.filter((r) => {
  if (reportYear.value !== 'ALL' && new Date(r.Timestamp).getFullYear() !== reportYear.value) return false
  if (reportTopic.value !== 'ALL' && r['Training Title'] !== reportTopic.value) return false
  return true
}))
const { currentPage: videoCurrentPage, totalPages: videoTotalPages, paginatedItems: paginatedVideoHistory, next: videoNext, prev: videoPrev } = usePagination(filteredVideoHistory)
const { currentPage: standardCurrentPage, totalPages: standardTotalPages, paginatedItems: paginatedStandardHistory, next: standardNext, prev: standardPrev } = usePagination(filteredStandardHistory)
const { currentPage: aiCurrentPage, totalPages: aiTotalPages, paginatedItems: paginatedAiHistory, next: aiNext, prev: aiPrev } = usePagination(filteredAiHistory)
const { currentPage: reportsCurrentPage, totalPages: reportsTotalPages, paginatedItems: paginatedReports, next: reportsNext, prev: reportsPrev } = usePagination(filteredReports)

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function dateBadge(iso) {
  const d = new Date(iso)
  return { month: MONTHS[d.getMonth()], day: d.getDate() }
}

function relativeTime(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (days <= 0) return t('quizHistoryView.today')
  if (days === 1) return t('quizHistoryView.yesterday')
  if (days < 7) return t('quizHistoryView.daysAgo', { days })
  return new Date(iso).toLocaleDateString()
}

// Attempts saved after the attempt_id migration (see backend
// migrate-add-attempt-id.js) get exact per-attempt matching. Older rows
// predating it have no AttemptID on either side — for those only, fall
// back to the old topic-only match so they don't silently show nothing,
// accepting the old cross-attempt-mixing limitation just for that legacy
// data rather than reintroducing it for new attempts too.
function wrongsForStandard(h) {
  if (h.AttemptID) return wrongAnswers.value.filter((w) => w.AttemptID === h.AttemptID)
  return wrongAnswers.value.filter((w) => !w.AttemptID && w.Topic === h.Topic)
}
function wrongsForAi(attemptId) {
  return aiWrongAnswers.value.filter((w) => w.AttemptID === attemptId)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('quizHistoryView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('quizHistoryView.loading') }}</div>

      <template v-else>
        <section class="mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.cpdHeading') }}</h2>
            <select v-model.number="cpdYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option v-for="y in cpdYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div class="bg-white rounded-xl2 px-5 py-4 flex items-center justify-between">
            <span class="text-sm font-display font-semibold" :class="cpdHoursThisYear >= CPD_TARGET_HOURS ? 'text-aqua' : 'text-coral'">
              {{ t('quizHistoryView.cpdHoursOfTarget', { hours: cpdHoursThisYear, target: CPD_TARGET_HOURS }) }}
            </span>
          </div>
          <button
            v-if="auth.staff?.isPharmacist"
            type="button"
            @click="downloadTrainingRecordCsv"
            class="mt-3 text-sm font-medium text-aqua hover:underline"
          >
            {{ t('quizHistoryView.downloadTrainingRecord') }}
          </button>
        </section>

        <section>
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.videoTrainingHeading') }}</h2>
            <select v-if="videoTrainingHistory.length" v-model="videoYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option value="ALL">{{ t('quizHistoryView.allYears') }}</option>
              <option v-for="y in videoYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="videoTrainingHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noVideoHistory') }}</p>
          </div>
          <div v-else-if="filteredVideoHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noHistoryFiltered') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="h in paginatedVideoHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: bilingual(w, 'Question Text') }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: bilingual(w, 'Correct Answer') }) }}</p>
                </div>
              </div>
            </details>
            <Pagination :current-page="videoCurrentPage" :total-pages="videoTotalPages" @prev="videoPrev" @next="videoNext" />
          </div>
        </section>

        <section class="mt-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.moduleQuizHeading') }}</h2>
            <select v-if="moduleQuizHistory.length" v-model="standardYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option value="ALL">{{ t('quizHistoryView.allYears') }}</option>
              <option v-for="y in standardYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="moduleQuizHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noModuleHistory') }}</p>
          </div>
          <div v-else-if="filteredStandardHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noHistoryFiltered') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="h in paginatedStandardHistory" :key="h.AttemptID || `${h.Name}|${h.Topic}|${h.Timestamp}`" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForStandard(h).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForStandard(h)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: bilingual(w, 'Question Text') }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: bilingual(w, 'Correct Answer') }) }}</p>
                </div>
              </div>
            </details>
            <Pagination :current-page="standardCurrentPage" :total-pages="standardTotalPages" @prev="standardPrev" @next="standardNext" />
          </div>
        </section>

        <section class="mt-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display text-base font-semibold text-ink">{{ t('quizHistoryView.aiPracticeHeading') }}</h2>
            <select v-if="aiHistory.length" v-model="aiYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
              <option value="ALL">{{ t('quizHistoryView.allYears') }}</option>
              <option v-for="y in aiYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div v-if="aiHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noAiHistory') }}</p>
          </div>
          <div v-else-if="filteredAiHistory.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noHistoryFiltered') }}</p>
          </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="h in paginatedAiHistory" :key="h.AttemptID" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#1E88C7' : '#E8622C'" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                  <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
                </div>
                <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
              </summary>
              <div v-if="wrongsForAi(h.AttemptID).length" class="mt-3 space-y-2">
                <div v-for="(w, j) in wrongsForAi(h.AttemptID)" :key="j" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-coral">{{ t('quizHistoryView.questionPrefix', { text: bilingual(w, 'Question Text') }) }}</p>
                  <p class="text-xs text-aqua font-semibold mt-1">{{ t('quizHistoryView.correctLabel', { text: bilingual(w, 'Correct Answer') }) }}</p>
                </div>
              </div>
            </details>
            <Pagination :current-page="aiCurrentPage" :total-pages="aiTotalPages" @prev="aiPrev" @next="aiNext" />
          </div>
        </section>

        <section v-if="auth.staff?.division === 'retail'" class="mt-8">
          <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('quizHistoryView.assessmentHeading') }}</h2>
          <div v-if="reports.length === 0" class="bg-white rounded-xl2 p-6 text-center">
            <p class="text-slate text-sm">{{ t('quizHistoryView.noAssessments') }}</p>
          </div>
          <template v-else>
            <div class="flex flex-wrap gap-2 mb-3">
              <select v-model="reportYear" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
                <option value="ALL">{{ t('quizHistoryView.allYears') }}</option>
                <option v-for="y in reportYears" :key="y" :value="y">{{ y }}</option>
              </select>
              <select v-model="reportTopic" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
                <option value="ALL">{{ t('quizHistoryView.allTopics') }}</option>
                <option v-for="t3 in reportTopics" :key="t3" :value="t3">{{ t3 }}</option>
              </select>
            </div>
            <div v-if="filteredReports.length === 0" class="bg-white rounded-xl2 p-6 text-center">
              <p class="text-slate text-sm">{{ t('quizHistoryView.noAssessmentsFiltered') }}</p>
            </div>
          <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
            <details v-for="(r, i) in paginatedReports" :key="i" class="px-5 py-3.5">
              <summary class="flex items-center gap-4 cursor-pointer">
                <div class="w-11 shrink-0 rounded-lg bg-aqualight text-center py-1">
                  <p class="text-[10px] font-medium text-aqua leading-none">{{ dateBadge(r.Timestamp).month }}</p>
                  <p class="text-base font-display font-bold text-deepsea leading-tight">{{ dateBadge(r.Timestamp).day }}</p>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-ink truncate">{{ r['Training Title'] }}</p>
                  <p class="text-xs text-slate">{{ t('quizHistoryView.filedBy', { manager: r.Manager }) }}</p>
                </div>
                <span class="text-sm font-display font-semibold shrink-0" :class="skillLevelColor(r['Skill Level'])">{{ r['Skill Level'] }}</span>
              </summary>
              <div class="mt-3 space-y-2">
                <div class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs text-slate">{{ t('quizHistoryView.quizScoreLabel') }} <span class="font-medium text-ink">{{ r['Quiz Score'] }}</span> · {{ t('quizHistoryView.competencyLabel') }} <span class="font-medium text-ink">{{ r.Fluency ?? '—' }}/10</span></p>
                </div>
                <div v-if="r['Product Knowledge Comments']" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-ink">{{ t('quizHistoryView.productKnowledge') }}</p>
                  <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r['Product Knowledge Comments'] }}</p>
                </div>
                <div v-if="r['Performance Gaps']" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-ink">{{ t('quizHistoryView.performanceGaps') }}</p>
                  <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r['Performance Gaps'] }}</p>
                </div>
                <div v-if="r.Recommendations" class="bg-seafoam rounded-lg p-3">
                  <p class="text-xs font-medium text-ink">{{ t('quizHistoryView.recommendations') }}</p>
                  <p class="text-xs text-slate mt-1 whitespace-pre-wrap">{{ r.Recommendations }}</p>
                </div>
              </div>
            </details>
            <Pagination :current-page="reportsCurrentPage" :total-pages="reportsTotalPages" @prev="reportsPrev" @next="reportsNext" />
          </div>
          </template>
        </section>
      </template>
    </main>
  </div>
</template>
