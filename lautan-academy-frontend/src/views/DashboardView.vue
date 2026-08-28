<script setup>
// Rebuilt to match the "Learning Dashboard" reference layout (hero progress
// card, course grid, right-rail widget) while staying honest about what
// data actually exists here — no resumable "lessons", no scheduled
// "upcoming quizzes" calendar, no search/notifications backend, so those
// mockup elements are either remapped to real data or dropped rather than
// faked. See CLAUDE.md hard rule 1: don't invent UI for data that isn't real.
//
// - Hero gauge = existing avg AI Practice score (was already here pre-
//   redesign), "Resume lesson" -> "Join a Quiz" scrolls to the existing
//   join-code form instead of a resume action that has no backing state.
// - "Enrolled Courses" grid -> Browse Courses categories (Resources),
//   since that's the actual browsable material in this app; each card
//   deep-links into ResourcesView pre-filtered to that category.
// - "Upcoming Quizzes" widget -> "Recent Practice", the real AI Practice
//   history, since nothing in this app is date-scheduled.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { CPD_TARGET_HOURS } from '../composables/useCpdHours'
import ProgressRing from '../components/ProgressRing.vue'
import StatCard from '../components/StatCard.vue'
import DigitCode from '../components/DigitCode.vue'

const ICON_HOURS = 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'
const ICON_CHECK = 'M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'
const ICON_BOOK = 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z'

const { t } = useI18n()
const passcode = ref('')
const joining = ref(false)
const joinError = ref('')
const history = ref([])
const loadingHistory = ref(true)
const cpdHoursThisYear = ref(0)
const resources = ref([])
const loadingResources = ref(true)
const router = useRouter()
const auth = useAuthStore()
const digitCode = ref(null)
const joinSection = ref(null)

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    history.value = data.aiResults || []
    cpdHoursThisYear.value = data.cpdHoursThisYear || 0
  } catch (e) { /* leave history empty — not fatal */ }
  loadingHistory.value = false
  // First-ever visit: nothing to review yet, so send focus straight to the
  // one action that matters instead of leaving the page inert.
  if (history.value.length === 0) digitCode.value?.focus()
})

onMounted(async () => {
  try {
    const data = await api.getResources()
    resources.value = data.referenceDocs || []
  } catch (e) { /* leave resources empty — not fatal */ }
  loadingResources.value = false
})

// First two words of the name as entered by the manager (e.g. "Mohd
// Hafiz" not just "Mohd") — falls back to whatever's there if only one
// word exists.
const firstName = computed(() => (auth.staff?.name || '').trim().split(/\s+/).slice(0, 2).join(' '))
const avatarInitial = computed(() => (auth.staff?.name || '?').trim().charAt(0).toUpperCase())

const avgPercent = computed(() => {
  if (!history.value.length) return 0
  return Math.round(history.value.reduce((sum, h) => sum + (parseInt(h.Percentage) || 0), 0) / history.value.length)
})

const recentPractice = computed(() =>
  [...history.value].sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)).slice(0, 5)
)
function monthAbbr(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short' }).toUpperCase() }
function dayOfMonth(iso) { return new Date(iso).getDate() }

// One card per Resources category — count + up to 3 subcategory tags, not
// a fake completion ring (nothing in a reference doc is "completed").
const categoryCards = computed(() => {
  const map = new Map()
  for (const r of resources.value) {
    if (!r.Category) continue
    if (!map.has(r.Category)) map.set(r.Category, { name: r.Category, count: 0, subcategories: new Set() })
    const entry = map.get(r.Category)
    entry.count++
    if (r.Subcategory) entry.subcategories.add(r.Subcategory)
  }
  return [...map.values()].map(c => ({ ...c, subcategories: [...c.subcategories].slice(0, 3) }))
})

function scrollToJoin() {
  joinSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  digitCode.value?.focus()
}

async function joinQuiz() {
  joinError.value = ''
  if (!/^\d{3}$/.test(passcode.value)) {
    joinError.value = t('dashboardView.errorBadCode')
    return
  }
  joining.value = true
  try {
    const data = await api.redeemAiQuiz(auth.staff.outlet, passcode.value)
    if (!data.questions || !data.questions.length) throw new Error(data.error || 'empty')
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ topic: data.topic, questions: data.questions, passcode: data.passcode }))
    router.push('/quiz')
  } catch (err) {
    joinError.value = t('dashboardView.errorInvalidCode')
  } finally {
    joining.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="max-w-5xl mx-auto px-6 pt-6 pb-2 flex items-center justify-between gap-4">
      <div class="min-w-0">
        <p class="text-slate text-xs tracking-wide truncate">{{ auth.staff?.outlet }}</p>
        <h1 class="font-display text-2xl font-semibold text-ink mt-0.5 truncate">{{ t('dashboardView.greeting', { name: firstName }) }}</h1>
      </div>
      <div class="w-10 h-10 rounded-full bg-aqualight flex items-center justify-center shrink-0">
        <span class="font-display font-semibold text-deepsea text-sm">{{ avatarInitial }}</span>
      </div>
    </header>

    <main class="dash-grid max-w-5xl mx-auto px-6 pb-10 pt-4">
      <!-- Hero: dark card, average practice score. Reuses the app's
           existing "ripple ring" signature rather than a second gauge style. -->
      <div class="area-hero bg-deepsea rounded-xl2 shadow-lg p-6 md:p-8 flex items-center gap-5 md:gap-8">
        <ProgressRing v-if="!loadingHistory" :percent="avgPercent" :size="88" accent="#1E88C7" label-color="text-white" :animate-count="history.length > 0" />
        <div v-else class="w-[88px] h-[88px] rounded-full bg-white/10 animate-pulse shrink-0" />
        <div class="min-w-0">
          <p class="text-aqualight text-[11px] font-semibold uppercase tracking-wide">{{ t('dashboardView.progressLabel') }}</p>
          <p class="font-display text-lg md:text-xl font-semibold text-white mt-1">
            {{ history.length === 0 ? t('dashboardView.noPracticeYet') : t('dashboardView.averagingPercent', { percent: avgPercent }) }}
          </p>
          <p class="text-white/60 text-sm mt-0.5">
            {{ history.length === 0 ? t('dashboardView.joinCodeBelow') : t('dashboardView.practiceAttempts', history.length) }}
          </p>
          <button v-if="!auth.impersonating" type="button" @click="scrollToJoin" class="mt-4 bg-aqua text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity">
            {{ t('dashboardView.joinQuizBtn') }}
          </button>
        </div>
      </div>

      <!-- Stat row: real counts already loaded above, no new data fetched. -->
      <section class="area-stats grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          :value="`${cpdHoursThisYear}/${CPD_TARGET_HOURS}`"
          :label="t('dashboardView.statHoursLabel')"
          accent="sand"
          :icon="ICON_HOURS"
        />
        <StatCard
          :value="history.length"
          :label="t('dashboardView.statAttemptsLabel')"
          accent="aqua"
          :icon="ICON_CHECK"
        />
        <StatCard
          :value="categoryCards.length"
          :label="t('dashboardView.statCoursesLabel')"
          accent="seagrass"
          :icon="ICON_BOOK"
        />
      </section>

      <!-- Browse Courses: one card per Resources category. -->
      <section class="area-grid">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-display text-base font-semibold text-ink">{{ t('dashboardView.browseCourses') }}</h2>
          <RouterLink to="/resources" class="text-aqua text-sm font-medium shrink-0">{{ t('dashboardView.viewAll') }}</RouterLink>
        </div>
        <div v-if="loadingResources" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div v-for="n in 4" :key="n" class="bg-white rounded-xl2 h-28 animate-pulse" />
        </div>
        <div v-else-if="categoryCards.length === 0" class="bg-white rounded-xl2 p-6 text-center text-slate text-sm">
          {{ t('dashboardView.noCourseMaterial') }}
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <RouterLink
            v-for="c in categoryCards"
            :key="c.name"
            :to="{ path: '/resources', query: { category: c.name } }"
            class="bg-white rounded-xl2 shadow-sm p-4 hover:shadow-md transition-shadow"
          >
            <div class="w-9 h-9 rounded-lg bg-aqualight flex items-center justify-center mb-3">
              <svg viewBox="0 0 24 24" class="w-4.5 h-4.5" fill="none" stroke="#1E88C7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z" />
              </svg>
            </div>
            <p class="font-display font-semibold text-ink text-sm truncate">{{ c.name }}</p>
            <p class="text-xs text-slate mt-0.5">{{ t('dashboardView.materialsCount', c.count) }}</p>
            <div v-if="c.subcategories.length" class="flex flex-wrap gap-1 mt-2">
              <span v-for="s in c.subcategories" :key="s" class="text-[10px] font-medium text-aqua bg-aqualight rounded-full px-2 py-0.5 truncate max-w-full">{{ s }}</span>
            </div>
          </RouterLink>
        </div>
      </section>

      <!-- Right-rail widget: real AI Practice history, not a fake schedule. -->
      <aside class="area-widget">
        <div class="bg-white rounded-xl2 shadow-sm p-5">
          <h2 class="font-display text-sm font-semibold text-ink mb-3">{{ t('dashboardView.recentPractice') }}</h2>
          <div v-if="loadingHistory" class="space-y-2">
            <div v-for="n in 3" :key="n" class="h-12 bg-seafoam rounded-lg animate-pulse" />
          </div>
          <div v-else-if="recentPractice.length === 0" class="text-slate text-xs">{{ t('dashboardView.noPracticeAttempts') }}</div>
          <div v-else class="space-y-3">
            <div v-for="h in recentPractice" :key="h.AttemptID" class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-lg bg-seafoam flex flex-col items-center justify-center shrink-0">
                <span class="text-[9px] font-bold text-slate uppercase leading-none">{{ monthAbbr(h.Timestamp) }}</span>
                <span class="text-sm font-display font-bold text-ink leading-none mt-0.5">{{ dayOfMonth(h.Timestamp) }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
                <p class="text-xs text-slate">{{ parseInt(h.Percentage) || 0 }}% score</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Join a Practice Quiz: unchanged existing feature, just relocated. -->
      <section v-if="!auth.impersonating" ref="joinSection" class="area-join">
        <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('dashboardView.joinPracticeQuiz') }}</h2>
        <form @submit.prevent="joinQuiz" class="bg-white rounded-xl2 p-5 shadow-sm">
          <div class="flex items-center justify-center gap-4 flex-wrap">
            <DigitCode ref="digitCode" v-model="passcode" :length="3" />
            <button type="submit" :disabled="joining" class="bg-coral text-white font-medium px-6 py-3 rounded-lg disabled:opacity-60 hover:opacity-90 transition-opacity">
              {{ joining ? t('dashboardView.joining') : t('dashboardView.join') }}
            </button>
          </div>
          <p v-if="joinError" class="text-coral text-sm mt-3 text-center flex items-center justify-center gap-1.5">
            <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            {{ joinError }}
          </p>
        </form>
      </section>
      <p v-else class="text-slate text-sm text-center py-4">{{ t('dashboardView.impersonatingNotice') }}</p>
    </main>
  </div>
</template>

<style scoped>
/* Mobile: single column, hero -> grid -> widget -> join, top to bottom.
   Desktop: two columns, widget forms a right rail spanning hero+grid+join. */
.dash-grid {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-areas: "hero" "stats" "grid" "widget" "join";
  gap: 1.5rem;
}
@media (min-width: 768px) {
  .dash-grid {
    grid-template-columns: 1fr 18rem;
    grid-template-areas:
      "hero   widget"
      "stats  widget"
      "grid   widget"
      "join   widget";
    align-items: start;
  }
}
.area-hero { grid-area: hero; }
.area-stats { grid-area: stats; }
.area-grid { grid-area: grid; }
.area-widget { grid-area: widget; }
.area-join { grid-area: join; }
</style>
