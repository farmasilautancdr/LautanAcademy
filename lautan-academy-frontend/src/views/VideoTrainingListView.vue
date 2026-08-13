<script setup>
// Video Training list — mirrors ModuleQuizView.vue's structure: fetch on
// mount, staff picks one, navigate to the watch page. No sessionStorage
// handoff here (unlike Module Quiz's topic->questions handoff) — the watch
// page only needs the video's own id, and fetches its question bank itself
// once the video actually ends (see VideoWatchView.vue).
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'

const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()

const videos = ref([])
const loading = ref(true)
const { currentPage, totalPages, paginatedItems: paginatedVideos, next, prev } = usePagination(videos)

onMounted(async () => {
  try {
    const data = await api.getVideoTrainings()
    videos.value = data.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function watch(video) {
  router.push(`/video-watch/${video.id}`)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('videoTrainingListView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('videoTrainingListView.loading') }}</div>
      <div v-else-if="videos.length === 0" class="text-slate text-sm">{{ t('videoTrainingListView.noVideosYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <button
          v-for="v in paginatedVideos"
          :key="v.id"
          @click="watch(v)"
          class="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-seafoam/50"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ v.title }}</p>
            <p class="text-xs text-slate">{{ v.topic }}</p>
          </div>
          <span class="text-aqua text-sm font-medium shrink-0">{{ t('videoTrainingListView.watch') }}</span>
        </button>
        <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
      </div>
    </main>
  </div>
</template>
