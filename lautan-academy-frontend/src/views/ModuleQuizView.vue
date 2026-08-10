<script setup>
// Standard Quiz topic picker — retail staff only (matches GAS: warehouse
// never had this, only AI Practice, see router guard + AppSidebar). Reuses
// QuizView.vue for the actual quiz-taking UI; this page just picks a topic
// and hands off via sessionStorage, same pattern DashboardView already uses
// for AI Practice's join flow. Every question in the topic's bank is used —
// no cap (GAS's old fixed-10 default was explicitly overridden per request).
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()

const allQuestions = ref([])
const myResults = ref([])
const loading = ref(true)
const selectedTopic = ref('')
const error = ref('')

onMounted(async () => {
  try {
    const [q, scoped] = await Promise.all([api.getQuestions(), api.getScopedData()])
    allQuestions.value = (q.questions || []).filter((x) => x.status === 'active')
    myResults.value = scoped.results || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

const topics = computed(() => [...new Set(allQuestions.value.map((q) => q.topic))].filter(Boolean).sort())
const bankCount = computed(() => allQuestions.value.filter((q) => q.topic === selectedTopic.value).length)

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
// Backend already no-ops a same-day duplicate silently — this pre-check
// just gives the same explicit warning GAS showed before letting someone
// start (and burn a "you already did this today" surprise at submit time).
const alreadyAttemptedToday = computed(() => {
  if (!selectedTopic.value) return false
  const now = new Date()
  return myResults.value.some((r) => r.Topic === selectedTopic.value && isSameCalendarDay(new Date(r.Timestamp), now))
})

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function start() {
  error.value = ''
  if (!selectedTopic.value) { error.value = t('moduleQuizView.errorPickModule'); return }
  if (alreadyAttemptedToday.value) { error.value = t('moduleQuizView.errorAlreadyAttempted', { topic: selectedTopic.value }); return }
  const questions = shuffle(allQuestions.value.filter((q) => q.topic === selectedTopic.value))
  if (!questions.length) { error.value = t('moduleQuizView.errorNoQuestions'); return }
  sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ kind: 'standard', topic: selectedTopic.value, questions }))
  router.push('/quiz')
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('moduleQuizView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('moduleQuizView.loading') }}</div>
      <div v-else class="bg-white rounded-xl2 p-6 shadow-sm space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('moduleQuizView.moduleLabel') }}</label>
          <select v-model="selectedTopic" @change="error = ''" class="w-full border border-slate/30 rounded-lg py-2.5 px-3">
            <option value="">{{ t('moduleQuizView.selectModule') }}</option>
            <option v-for="t2 in topics" :key="t2" :value="t2">{{ t2 }}</option>
          </select>
        </div>

        <p v-if="selectedTopic" class="text-slate text-sm">
          {{ t('moduleQuizView.questionCount', bankCount) }}
        </p>

        <p v-if="error" class="text-coral text-sm">{{ error }}</p>

        <button @click="start" :disabled="!selectedTopic" class="w-full bg-aqua text-white font-medium py-3 rounded-lg disabled:opacity-60">
          {{ t('moduleQuizView.startQuiz') }}
        </button>
      </div>
    </main>
  </div>
</template>
