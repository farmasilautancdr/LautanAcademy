<script setup>
// Questions come from sessionStorage (set by DashboardView after a
// successful /quiz/redeem) rather than a route param + API fetch — there's
// no "get quiz by id" endpoint, AI Practice quizzes only exist ephemerally
// behind the passcode that was just redeemed.
//
// Question shape from the real backend (Gemini-generated, matches
// buildQuizPrompt's schema exactly): question_en/ms, opt1_en/ms..opt4_en/ms,
// correct (0-3 index) — flat fields, not an options array.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()

const stored = JSON.parse(sessionStorage.getItem('lautan_active_quiz') || 'null')
const topic = stored?.topic || 'Practice'
const passcode = stored?.passcode || ''
const kind = stored?.kind || 'ai' // 'standard' (Module Quiz, ModuleQuizView) | 'ai' (Practice, DashboardView)
const questions = ref(stored?.questions || [])

const currentIndex = ref(0)
const answers = ref({}) // { questionIndex: chosenOptionIndex }
const lang = ref('en')
const submitting = ref(false)
const errorMsg = ref('')

const currentQuestion = computed(() => questions.value[currentIndex.value])
const isLastQuestion = computed(() => currentIndex.value === questions.value.length - 1)
const answeredCount = computed(() => Object.keys(answers.value).length)

function optionsFor(q) {
  const suffix = lang.value === 'en' ? '_en' : '_ms'
  return [q['opt1' + suffix], q['opt2' + suffix], q['opt3' + suffix], q['opt4' + suffix]]
}

// Once an answer is picked for a question it's locked in — matches the
// vanilla app's handleChoice, which disables the option buttons the instant
// one is tapped so the correct/wrong reveal can't be gamed by re-clicking.
const isRevealed = computed(() => answers.value[currentIndex.value] !== undefined)

function selectAnswer(optIndex) {
  if (isRevealed.value) return
  answers.value[currentIndex.value] = optIndex
}

function optionClass(i) {
  if (!isRevealed.value) {
    return 'border-slate/20 hover:border-aqua/50'
  }
  if (i === currentQuestion.value.correct) return 'border-aqua bg-aqualight text-deepsea font-medium'
  if (i === answers.value[currentIndex.value]) return 'border-coral bg-coral/10 text-coral font-medium'
  return 'border-slate/20 opacity-50'
}

function next() {
  if (!isLastQuestion.value) currentIndex.value++
}
function back() {
  if (currentIndex.value > 0) currentIndex.value--
}

async function submit() {
  submitting.value = true
  errorMsg.value = ''

  let score = 0
  const wrongAnswers = []
  questions.value.forEach((q, i) => {
    const chosenIdx = answers.value[i]
    const opts = optionsFor(q)
    if (chosenIdx === q.correct) {
      score++
    } else {
      wrongAnswers.push({
        qText: lang.value === 'en' ? q.question_en : q.question_ms,
        userChoice: opts[chosenIdx] ?? '',
        correctText: opts[q.correct],
      })
    }
  })
  const total = questions.value.length
  const percentage = Math.round((score / total) * 100)

  try {
    if (kind === 'standard') {
      await api.saveResult({
        name: auth.staff.name,
        outlet: auth.staff.outlet,
        topic,
        score: `${score}/${total}`,
        perc: `${percentage}%`,
        wrongAnswers,
      })
    } else {
      await api.saveAiResult({
        attemptId: 'AI' + Date.now(),
        name: auth.staff.name,
        outlet: auth.staff.outlet,
        topic,
        score: `${score}/${total}`,
        perc: `${percentage}%`,
        wrongAnswers,
        passcode,
      })
    }
    sessionStorage.setItem('lautan_last_result', JSON.stringify({ scoreCorrect: score, scoreTotal: total, percentage, wrongAnswers }))
    sessionStorage.removeItem('lautan_active_quiz')
    router.push('/result')
  } catch (err) {
    errorMsg.value = 'Could not submit your answers. Check your connection and try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <div v-if="questions.length === 0" class="p-6 text-coral text-sm">No active quiz — join one from the dashboard first.</div>

    <div v-else class="max-w-lg mx-auto px-6 py-8">
      <div class="flex items-center justify-between mb-4">
        <span class="text-slate text-xs">Question {{ currentIndex + 1 }} of {{ questions.length }}</span>
        <button
          @click="lang = lang === 'en' ? 'ms' : 'en'"
          class="text-xs font-medium text-aqua border border-aqua/40 rounded-full px-3 py-1"
        >
          {{ lang === 'en' ? 'BM' : 'EN' }}
        </button>
      </div>

      <div class="w-full bg-white/60 rounded-full h-1.5 mb-6">
        <div class="bg-aqua h-1.5 rounded-full transition-all duration-300" :style="{ width: ((currentIndex + 1) / questions.length * 100) + '%' }" />
      </div>

      <div class="bg-white rounded-xl2 p-6 shadow-sm">
        <p class="font-display font-semibold text-ink text-lg mb-5">
          {{ lang === 'en' ? currentQuestion.question_en : currentQuestion.question_ms }}
        </p>

        <div class="space-y-3">
          <button
            v-for="(opt, i) in optionsFor(currentQuestion)"
            :key="i"
            @click="selectAnswer(i)"
            class="w-full text-left px-4 py-3 rounded-lg border transition-colors"
            :class="optionClass(i)"
          >
            {{ opt }}
            <span v-if="isRevealed && i === currentQuestion.correct" class="ml-1">✓</span>
          </button>
        </div>
      </div>

      <p v-if="errorMsg" class="text-coral text-sm mt-4 text-center">{{ errorMsg }}</p>

      <div class="flex items-center justify-between mt-6">
        <button
          @click="back"
          :disabled="currentIndex === 0"
          class="text-slate text-sm disabled:opacity-30"
        >
          ← Back
        </button>

        <button
          v-if="!isLastQuestion"
          @click="next"
          class="bg-deepsea text-white text-sm font-medium px-6 py-2.5 rounded-lg"
        >
          Next
        </button>
        <button
          v-else
          @click="submit"
          :disabled="submitting || answeredCount < questions.length"
          class="bg-coral text-white text-sm font-medium px-6 py-2.5 rounded-lg disabled:opacity-50"
        >
          {{ submitting ? 'Submitting...' : 'Submit quiz' }}
        </button>
      </div>
    </div>
  </div>
</template>
