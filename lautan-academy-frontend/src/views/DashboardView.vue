<script setup>
// The real backend has no "browse quizzes" concept — AI Practice quizzes are
// ephemeral, outlet-scoped, and joined by a manager-issued passcode only
// (see /quiz/redeem). There's also no home yet for the topic-based Standard
// Quiz question bank (that data still lives only in GAS's Questions sheet,
// never migrated) — so this dashboard covers AI Practice only for now.
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

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

async function joinQuiz() {
  joinError.value = ''
  if (!/^\d{3}$/.test(passcode.value.trim())) {
    joinError.value = 'Enter the 3-digit practice code your manager shared.'
    return
  }
  joining.value = true
  try {
    const data = await api.redeemAiQuiz(auth.staff.outlet, passcode.value.trim())
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
    <header class="bg-deepsea px-6 py-5 flex items-center justify-between">
      <div>
        <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
        <h1 class="font-display text-xl font-semibold text-white">Hi {{ auth.staff?.name?.split(' ')[0] }}</h1>
      </div>
      <button @click="logout" class="text-aqualight text-sm hover:text-white transition-colors">Log out</button>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <h2 class="font-display text-lg font-semibold text-ink mb-4">Join a Practice Quiz</h2>

      <form @submit.prevent="joinQuiz" class="bg-white rounded-xl2 p-5 shadow-sm flex items-center gap-3">
        <input
          v-model="passcode"
          type="text"
          inputmode="numeric"
          maxlength="3"
          placeholder="3-digit code"
          class="flex-1 text-center text-xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-2.5"
        />
        <button type="submit" :disabled="joining" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
          {{ joining ? 'Joining...' : 'Join' }}
        </button>
      </form>
      <p v-if="joinError" class="text-coral text-sm mt-2">{{ joinError }}</p>

      <section class="mt-10">
        <h2 class="font-display text-lg font-semibold text-ink mb-4">Recent attempts</h2>
        <div v-if="loadingHistory" class="text-slate text-sm">Loading...</div>
        <div v-else-if="history.length === 0" class="text-slate text-sm">No practice attempts yet.</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="h in history.slice(0, 5)" :key="h.AttemptID" class="flex items-center justify-between px-5 py-3">
            <div>
              <p class="text-sm font-medium text-ink">{{ h.Topic }}</p>
              <p class="text-xs text-slate">{{ new Date(h.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold" :class="parseInt(h.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ h.Score }}
            </span>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
