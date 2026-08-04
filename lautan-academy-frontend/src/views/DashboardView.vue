<script setup>
// The real backend has no "browse quizzes" concept — AI Practice quizzes are
// ephemeral, outlet-scoped, and joined by a manager-issued passcode only
// (see /quiz/redeem). There's also no home yet for the topic-based Standard
// Quiz question bank (that data still lives only in GAS's Questions sheet,
// never migrated) — so this dashboard covers AI Practice only for now.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import ProgressRing from '../components/ProgressRing.vue'
import DigitCode from '../components/DigitCode.vue'

const passcode = ref('')
const joining = ref(false)
const joinError = ref('')
const history = ref([])
const loadingHistory = ref(true)
const router = useRouter()
const auth = useAuthStore()

onMounted(async () => {
  try {
    const data = await api.getScopedData()
    history.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave history empty — not fatal */ }
  loadingHistory.value = false
})

const avgPercent = computed(() => {
  if (!history.value.length) return 0
  return Math.round(history.value.reduce((sum, h) => sum + (parseInt(h.Percentage) || 0), 0) / history.value.length)
})

function relativeTime(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

async function joinQuiz() {
  joinError.value = ''
  if (!/^\d{3}$/.test(passcode.value)) {
    joinError.value = 'Enter the 3-digit practice code your manager shared.'
    return
  }
  joining.value = true
  try {
    const data = await api.redeemAiQuiz(auth.staff.outlet, passcode.value)
    if (!data.questions || !data.questions.length) throw new Error(data.error || 'empty')
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ topic: data.topic, questions: data.questions, passcode: data.passcode }))
    router.push('/quiz')
  } catch (err) {
    joinError.value = 'Invalid or expired code for your outlet.'
  } finally {
    joining.value = false
  }
}

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 pt-6 pb-10">
      <div class="max-w-3xl mx-auto flex items-center justify-between">
        <div>
          <p class="text-aqualight text-xs tracking-wide">{{ auth.staff?.outlet }}</p>
          <h1 class="font-display text-2xl font-semibold text-white mt-0.5">Hi {{ auth.staff?.name?.split(' ')[0] }}</h1>
        </div>
        <button @click="logout" class="text-aqualight text-sm hover:text-white transition-colors">Log out</button>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-6 -mt-6 pb-10">
      <!-- Hero: average practice score, the one thing worth leading with —
           real data, not a placeholder metric. Reuses the app's existing
           "ripple ring" signature rather than introducing a second one. -->
      <div class="bg-white rounded-xl2 shadow-lg p-6 flex items-center gap-5">
        <ProgressRing v-if="!loadingHistory" :percent="avgPercent" :size="88" :accent="avgPercent >= 70 ? '#17A398' : '#FF8552'" />
        <div v-else class="w-[88px] h-[88px] rounded-full bg-seafoam animate-pulse" />
        <div>
          <p class="font-display text-lg font-semibold text-ink">
            {{ history.length === 0 ? 'No practice yet' : `Averaging ${avgPercent}%` }}
          </p>
          <p class="text-slate text-sm mt-0.5">
            {{ history.length === 0 ? 'Join a code below to get started' : `${history.length} practice attempt${history.length === 1 ? '' : 's'} so far` }}
          </p>
        </div>
      </div>

      <section class="mt-6">
        <h2 class="font-display text-base font-semibold text-ink mb-3">Join a Practice Quiz</h2>
        <form @submit.prevent="joinQuiz" class="bg-white rounded-xl2 p-5 shadow-sm">
          <div class="flex items-center justify-center gap-4 flex-wrap">
            <DigitCode v-model="passcode" :length="3" />
            <button type="submit" :disabled="joining" class="bg-coral text-white font-medium px-6 py-3 rounded-lg disabled:opacity-60 hover:opacity-90 transition-opacity">
              {{ joining ? 'Joining...' : 'Join' }}
            </button>
          </div>
          <p v-if="joinError" class="text-coral text-sm mt-3 text-center">{{ joinError }}</p>
        </form>
      </section>

      <section class="mt-8">
        <h2 class="font-display text-base font-semibold text-ink mb-3">Recent attempts</h2>
        <div v-if="loadingHistory" class="text-slate text-sm">Loading...</div>
        <div v-else-if="history.length === 0" class="bg-white rounded-xl2 p-6 text-center">
          <p class="text-slate text-sm">Nothing here yet — your first practice attempt will show up after you join a code.</p>
        </div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="h in history.slice(0, 5)" :key="h.AttemptID" class="flex items-center gap-4 px-5 py-3.5">
            <ProgressRing :percent="parseInt(h.Percentage) || 0" :size="40" :accent="parseInt(h.Percentage) >= 70 ? '#17A398' : '#FF8552'" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ h.Topic }}</p>
              <p class="text-xs text-slate">{{ relativeTime(h.Timestamp) }}</p>
            </div>
            <span class="text-sm font-display font-semibold text-ink shrink-0">{{ h.Score }}</span>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
