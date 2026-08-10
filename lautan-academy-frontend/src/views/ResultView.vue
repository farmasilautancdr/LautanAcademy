<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ProgressRing from '../components/ProgressRing.vue'

const router = useRouter()
const { t } = useI18n()
const result = JSON.parse(sessionStorage.getItem('lautan_last_result') || 'null')

const passed = computed(() => result && Number(result.percentage) >= 70)

function backToDashboard() {
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen bg-deepsea flex items-center justify-center px-6">
    <div v-if="!result" class="text-white text-center">
      <p>{{ t('resultView.noResult') }}</p>
      <button @click="backToDashboard" class="mt-4 text-aqualight underline">{{ t('resultView.backToDashboard') }}</button>
    </div>

    <div v-else class="bg-white rounded-xl2 p-8 max-w-sm w-full shadow-xl">
      <div class="text-center">
        <ProgressRing :percent="Math.round(result.percentage)" :size="120" :accent="passed ? '#1E88C7' : '#E8622C'" />

        <h1 class="font-display text-xl font-semibold text-ink mt-5">
          {{ passed ? t('resultView.passedTitle') : t('resultView.practiceTitle') }}
        </h1>
        <p class="text-slate text-sm mt-1">
          {{ t('resultView.scoreLine', { correct: result.scoreCorrect, total: result.scoreTotal }) }}
        </p>
      </div>

      <div v-if="result.wrongAnswers?.length" class="mt-6 text-left space-y-2 max-h-60 overflow-y-auto">
        <p class="text-xs font-semibold text-slate uppercase tracking-wide">{{ t('resultView.missedQuestions') }}</p>
        <div v-for="(w, i) in result.wrongAnswers" :key="i" class="bg-seafoam rounded-lg p-3">
          <p class="text-xs font-medium text-coral">{{ t('resultView.questionPrefix', { text: w.qText }) }}</p>
          <p class="text-xs text-aqua font-semibold mt-1">{{ t('resultView.correctLabel', { text: w.correctText }) }}</p>
        </div>
      </div>

      <button
        @click="backToDashboard"
        class="mt-6 w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors"
      >
        {{ t('resultView.backToDashboard') }}
      </button>
    </div>
  </div>
</template>
