<script setup>
// Questions come from sessionStorage (set by DashboardView after a
// successful /quiz/redeem, or ModuleQuizView for Standard Quiz) rather than
// a route param + API fetch.
//
// Server-graded, not client-graded: neither quiz type's question objects
// carry a `correct` field anymore (backend strips it from GET /questions
// and POST /quiz/redeem). Picking an answer calls a live per-question check
// endpoint for the instant reveal — that response is UX only, not
// authoritative. submit() sends the raw {id/index, chosen} answer set and
// the server independently grades the whole attempt from its own stored
// data, so a tampered/faked check response can't change what gets saved.
//
// Question-content language (_en/_ms field suffix) follows the shared
// vue-i18n locale, same as the rest of the app's UI chrome — this used to
// be a separate local `lang` ref with its own toggle button; reconciled
// onto the one shared mechanism (see Phase 1 spec's flagged open risk).
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'

const router = useRouter()
const auth = useAuthStore()
const { t, locale } = useI18n()

const stored = JSON.parse(sessionStorage.getItem('lautan_active_quiz') || 'null')
const topic = stored?.topic || 'Practice'
const passcode = stored?.passcode || ''
const kind = stored?.kind || 'ai' // 'standard' (Module Quiz, ModuleQuizView) | 'ai' (Practice, DashboardView)
const questions = ref(stored?.questions || [])

const currentIndex = ref(0)
const answers = ref({}) // { questionIndex: { chosen, correct, correctIndex } }
const checking = ref(false)
const checkError = ref('')
const submitting = ref(false)
const errorMsg = ref('')
const hasSubmitted = ref(false)

const currentQuestion = computed(() => questions.value[currentIndex.value])
const isLastQuestion = computed(() => currentIndex.value === questions.value.length - 1)
const answeredCount = computed(() => Object.keys(answers.value).length)
const currentAnswer = computed(() => answers.value[currentIndex.value])

function optionsFor(q) {
  const suffix = locale.value === 'en' ? '_en' : '_ms'
  return [q['opt1' + suffix], q['opt2' + suffix], q['opt3' + suffix], q['opt4' + suffix]]
}

// Once an answer is picked for a question it's locked in — matches the
// vanilla app's handleChoice, which disables the option buttons the instant
// one is tapped so the correct/wrong reveal can't be gamed by re-clicking.
const isRevealed = computed(() => currentAnswer.value !== undefined)

async function selectAnswer(optIndex) {
  if (isRevealed.value || checking.value) return
  checkError.value = ''
  checking.value = true
  try {
    const result = kind === 'standard'
      ? await api.checkStandardAnswer(currentQuestion.value.id, optIndex)
      : await api.checkAiAnswer(auth.staff.outlet, passcode, currentIndex.value, optIndex)
    answers.value[currentIndex.value] = { chosen: optIndex, correct: result.correct, correctIndex: result.correctIndex }
  } catch (err) {
    checkError.value = t('quizView.errorCheckFailed')
  } finally {
    checking.value = false
  }
}

function optionClass(i) {
  if (!isRevealed.value) {
    return 'border-slate/20 hover:border-aqua/50'
  }
  if (i === currentAnswer.value.correctIndex) return 'border-aqua bg-aqualight text-deepsea font-medium'
  if (i === currentAnswer.value.chosen) return 'border-coral bg-coral/10 text-coral font-medium'
  return 'border-slate/20 opacity-50'
}

function next() {
  if (!isLastQuestion.value) currentIndex.value++
}
function back() {
  if (currentIndex.value > 0) currentIndex.value--
}

async function gradeAndSave() {
  if (hasSubmitted.value) return null
  hasSubmitted.value = true

  const payloadAnswers = questions.value.map((q, i) => {
    const a = answers.value[i]
    return kind === 'standard' ? { id: q.id, chosen: a?.chosen } : { index: i, chosen: a?.chosen }
  })

  return kind === 'standard'
    ? api.saveResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
    : api.saveAiResult({ attemptId: 'AI' + Date.now(), name: auth.staff.name, outlet: auth.staff.outlet, topic, passcode, answers: payloadAnswers })
}

async function submitQuiz() {
  submitting.value = true
  errorMsg.value = ''

  try {
    const data = await gradeAndSave()
    if (!data) return

    // Missed-question summary for ResultView comes from the live per-answer
    // checks already done during the quiz, not recomputed here — the score
    // shown (data.score/data.total/data.percentage) is the server's, though.
    const wrongAnswers = []
    questions.value.forEach((q, i) => {
      const a = answers.value[i]
      if (a && a.chosen !== a.correctIndex) {
        const opts = optionsFor(q)
        wrongAnswers.push({
          qText: locale.value === 'en' ? q.question_en : q.question_ms,
          userChoice: opts[a.chosen] ?? '',
          correctText: opts[a.correctIndex] ?? '',
        })
      }
    })

    sessionStorage.setItem('lautan_last_result', JSON.stringify({ scoreCorrect: data.score, scoreTotal: data.total, percentage: data.percentage, wrongAnswers }))
    sessionStorage.removeItem('lautan_active_quiz')
    router.push('/result')
  } catch (err) {
    hasSubmitted.value = false
    errorMsg.value = err.message || t('quizView.errorSubmitFailed')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <div v-if="questions.length === 0" class="p-6 text-coral text-sm">{{ t('quizView.noActiveQuiz') }}</div>

    <div v-else class="max-w-lg mx-auto px-6 py-8">
      <div class="flex items-center justify-between mb-4">
        <span class="text-slate text-xs">{{ t('quizView.questionProgress', { current: currentIndex + 1, total: questions.length }) }}</span>
        <LanguageSwitcher />
      </div>

      <div class="w-full bg-white/60 rounded-full h-1.5 mb-6">
        <div class="bg-aqua h-1.5 rounded-full transition-all duration-300" :style="{ width: ((currentIndex + 1) / questions.length * 100) + '%' }" />
      </div>

      <div class="bg-white rounded-xl2 p-6 shadow-sm">
        <p class="font-display font-semibold text-ink text-lg mb-5">
          {{ locale === 'en' ? currentQuestion.question_en : currentQuestion.question_ms }}
        </p>

        <div class="space-y-3">
          <button
            v-for="(opt, i) in optionsFor(currentQuestion)"
            :key="i"
            @click="selectAnswer(i)"
            :disabled="checking"
            class="w-full text-left px-4 py-3 rounded-lg border transition-colors disabled:opacity-70"
            :class="optionClass(i)"
          >
            {{ opt }}
            <span v-if="isRevealed && i === currentAnswer.correctIndex" class="ml-1">✓</span>
          </button>
        </div>

        <p v-if="checking" class="text-slate text-xs mt-3 text-center">{{ t('quizView.checking') }}</p>
        <p v-if="checkError" class="text-coral text-xs mt-3 text-center">{{ checkError }}</p>
      </div>

      <p v-if="errorMsg" class="text-coral text-sm mt-4 text-center">{{ errorMsg }}</p>

      <div class="flex items-center justify-between mt-6">
        <button
          @click="back"
          :disabled="currentIndex === 0 || (kind === 'standard' && answeredCount >= 1)"
          class="text-slate text-sm disabled:opacity-30"
        >
          {{ t('quizView.back') }}
        </button>

        <button
          v-if="!isLastQuestion"
          @click="next"
          class="bg-deepsea text-white text-sm font-medium px-6 py-2.5 rounded-lg"
        >
          {{ t('quizView.next') }}
        </button>
        <button
          v-else
          @click="submitQuiz"
          :disabled="submitting || answeredCount < questions.length"
          class="bg-coral text-white text-sm font-medium px-6 py-2.5 rounded-lg disabled:opacity-50"
        >
          {{ submitting ? t('quizView.submitting') : t('quizView.submitQuiz') }}
        </button>
      </div>
    </div>
  </div>
</template>
