<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import ProgressRing from '../components/ProgressRing.vue'

const router = useRouter()
const result = JSON.parse(sessionStorage.getItem('lautan_last_result') || 'null')

const passed = computed(() => result && Number(result.percentage) >= 70)

function backToDashboard() {
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen bg-deepsea flex items-center justify-center px-6">
    <div v-if="!result" class="text-white text-center">
      <p>No result found.</p>
      <button @click="backToDashboard" class="mt-4 text-aqualight underline">Back to My Learning</button>
    </div>

    <div v-else class="bg-white rounded-xl2 p-8 max-w-sm w-full shadow-xl">
      <div class="text-center">
        <ProgressRing :percent="Math.round(result.percentage)" :size="120" :accent="passed ? '#17A398' : '#FF8552'" />

        <h1 class="font-display text-xl font-semibold text-ink mt-5">
          {{ passed ? 'Well done!' : 'Keep practicing' }}
        </h1>
        <p class="text-slate text-sm mt-1">
          You scored {{ result.scoreCorrect }} out of {{ result.scoreTotal }}
        </p>
      </div>

      <div v-if="result.wrongAnswers?.length" class="mt-6 text-left space-y-2 max-h-60 overflow-y-auto">
        <p class="text-xs font-semibold text-slate uppercase tracking-wide">Missed questions</p>
        <div v-for="(w, i) in result.wrongAnswers" :key="i" class="bg-seafoam rounded-lg p-3">
          <p class="text-xs font-medium text-coral">Q: {{ w.qText }}</p>
          <p class="text-xs text-aqua font-semibold mt-1">✓ Correct: {{ w.correctText }}</p>
        </div>
      </div>

      <button
        @click="backToDashboard"
        class="mt-6 w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors"
      >
        Back to My Learning
      </button>
    </div>
  </div>
</template>
