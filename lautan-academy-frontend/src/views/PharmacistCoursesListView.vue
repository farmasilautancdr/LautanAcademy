<script setup>
// Mirrors VideoTrainingListView.vue exactly, but fetches the gated
// pharmacist-only list and routes readings to a different watch page. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()

const courses = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.getPharmacistCourses()
    courses.value = data.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function open(course) {
  if (course.kind === 'reading') router.push(`/reading-view/${course.id}`)
  else router.push(`/video-watch/${course.id}`)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('pharmacistCoursesListView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('pharmacistCoursesListView.loading') }}</div>
      <div v-else-if="courses.length === 0" class="text-slate text-sm">{{ t('pharmacistCoursesListView.noCoursesYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <button
          v-for="c in courses"
          :key="c.id"
          @click="open(c)"
          class="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-seafoam/50"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ c.title }}</p>
            <p class="text-xs text-slate">{{ c.topic }}</p>
          </div>
          <span class="text-aqua text-sm font-medium shrink-0">
            {{ c.kind === 'reading' ? t('pharmacistCoursesListView.read') : t('pharmacistCoursesListView.watch') }}
          </span>
        </button>
      </div>
    </main>
  </div>
</template>
