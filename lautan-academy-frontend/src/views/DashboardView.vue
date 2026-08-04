<script setup>
// Quiz History and Resources used to be sections on this same page — split
// into their own routes (QuizHistoryView, ResourcesView) since the sidebar
// nav treats them as distinct destinations. This page keeps the hero
// (average score, still needs aiResults for that) and the join-code form.
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
    history.value = data.aiResults || []
  } catch (e) { /* leave history empty — not fatal */ }
  loadingHistory.value = false
})

const avgPercent = computed(() => {
  if (!history.value.length) return 0
  return Math.round(history.value.reduce((sum, h) => sum + (parseInt(h.Percentage) || 0), 0) / history.value.length)
})

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
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 pt-6 pb-10">
      <div class="max-w-3xl mx-auto">
        <p class="text-aqualight text-xs tracking-wide">{{ auth.staff?.outlet }}</p>
        <h1 class="font-display text-2xl font-semibold text-white mt-0.5">Hi {{ auth.staff?.name?.split(' ')[0] }}</h1>
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
    </main>
  </div>
</template>
