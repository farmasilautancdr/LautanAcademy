<script setup>
// Reading-kind counterpart to VideoWatchView.vue — "I've read this" replaces
// the YouTube ENDED event as the quiz-unlock gate. Same sessionStorage
// handoff to QuizView.vue, still kind: 'video' in that envelope since
// grading/CPD-hours only key off topic. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const course = ref(null)
const loadError = ref('')
const starting = ref(false)

onMounted(async () => {
  try {
    const data = await api.getPharmacistCourses()
    course.value = (data.videoTrainings || []).find(v => String(v.id) === route.params.id)
    if (!course.value) {
      loadError.value = t('readingView.errorNotFound')
    }
  } catch (e) {
    loadError.value = t('readingView.errorNotFound')
  }
})

async function markRead() {
  starting.value = true
  loadError.value = ''
  try {
    const data = await api.getVideoQuestions(course.value.topic)
    const questions = data.questions || []
    if (!questions.length) {
      loadError.value = t('readingView.errorNoQuestions')
      return
    }
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ kind: 'video', topic: course.value.topic, questions }))
    router.push('/quiz')
  } catch (e) {
    loadError.value = t('readingView.errorNoQuestions')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <h1 class="font-display text-xl font-semibold text-white">{{ course?.title || t('readingView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="loadError" class="text-coral text-sm mb-4">{{ loadError }}</p>
      <div v-if="course" class="bg-white rounded-xl2 p-5 shadow-sm">
        <p class="text-sm text-ink whitespace-pre-wrap">{{ course.body }}</p>
        <button
          type="button"
          @click="markRead"
          :disabled="starting"
          class="mt-5 bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60"
        >
          {{ starting ? t('readingView.starting') : t('readingView.markRead') }}
        </button>
      </div>
    </main>
  </div>
</template>
