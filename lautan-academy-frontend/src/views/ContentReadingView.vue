<script setup>
// Reading gate for a quiz_required Browse Courses Content entry — same
// "I've read this" pattern as ReadingView.vue (Pharmacist Courses), but
// against the general content table/content_questions bank instead of
// video_trainings/video_questions, and its own kind: 'content' envelope
// since grading/CPD go through their own endpoint. See
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const entry = ref(null)
const loadError = ref('')
const starting = ref(false)

onMounted(async () => {
  try {
    const data = await api.getContent()
    entry.value = (data.content || []).find(c => String(c.ID) === route.params.id)
    if (!entry.value) {
      loadError.value = t('contentReadingView.errorNotFound')
    }
  } catch (e) {
    loadError.value = t('contentReadingView.errorNotFound')
  }
})

async function markRead() {
  starting.value = true
  loadError.value = ''
  try {
    const data = await api.getContentQuestions(entry.value.Topic)
    const questions = data.questions || []
    if (!questions.length) {
      loadError.value = t('contentReadingView.errorNoQuestions')
      return
    }
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ kind: 'content', topic: entry.value.Topic, questions }))
    router.push('/quiz')
  } catch (e) {
    loadError.value = t('contentReadingView.errorNoQuestions')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <h1 class="font-display text-xl font-semibold text-white">{{ entry?.Title || t('contentReadingView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="loadError" class="text-coral text-sm mb-4">{{ loadError }}</p>
      <div v-if="entry" class="bg-white rounded-xl2 p-5 shadow-sm">
        <p class="text-slate text-xs mb-3">{{ entry.Topic }} · {{ t('contentReadingView.cpdHourValue', { hours: entry.Hours }, entry.Hours) }}</p>
        <p class="text-sm text-ink whitespace-pre-wrap">{{ entry.Body }}</p>
        <button
          type="button"
          @click="markRead"
          :disabled="starting"
          class="mt-5 bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60"
        >
          {{ starting ? t('contentReadingView.starting') : t('contentReadingView.markRead') }}
        </button>
      </div>
    </main>
  </div>
</template>
