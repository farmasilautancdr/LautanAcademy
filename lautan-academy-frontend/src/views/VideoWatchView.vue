<script setup>
// Embeds the YouTube IFrame Player API inline — staff never leave the app,
// no navigation to youtube.com. Free seeking allowed (no custom control
// restrictions); the quiz is gated on the player's real ENDED state, not
// on elapsed watch time, so seeking doesn't bypass any technical control.
// On ENDED: fetch that video's topic's question bank and hand off to
// QuizView.vue via the same sessionStorage envelope Module Quiz already
// uses (kind/topic/questions), just with kind: 'video'.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const video = ref(null)
const loadError = ref('')
const playerReady = ref(false)

// Parses as a real URL and checks the hostname exactly (not a substring
// match against the raw string) — same approach as the backend's own
// extractYouTubeId in routes/videoTraining.js, kept in sync after a
// security review flagged the original unanchored regex there.
function extractYouTubeId(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '')
  const idPattern = /^[a-zA-Z0-9_-]{11}$/
  if (host === 'youtube.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v')
      return id && idPattern.test(id) ? id : null
    }
    const embedMatch = parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})$/)
    return embedMatch ? embedMatch[1] : null
  }
  if (host === 'youtu.be') {
    const shortMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_-]{11})$/)
    return shortMatch ? shortMatch[1] : null
  }
  return null
}

let player = null

function loadIframeApi() {
  return new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(); return }
    const existing = document.getElementById('youtube-iframe-api')
    if (existing) {
      window.onYouTubeIframeAPIReady = resolve
      return
    }
    const script = document.createElement('script')
    script.id = 'youtube-iframe-api'
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = reject
    window.onYouTubeIframeAPIReady = resolve
    document.head.appendChild(script)
  })
}

async function onVideoEnded() {
  try {
    const data = await api.getVideoQuestions(video.value.topic)
    const questions = data.questions || []
    if (!questions.length) {
      loadError.value = t('videoWatchView.errorNoQuestions')
      return
    }
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ kind: 'video', topic: video.value.topic, questions }))
    router.push('/quiz')
  } catch (e) {
    loadError.value = t('videoWatchView.errorNoQuestions')
  }
}

onMounted(async () => {
  try {
    const data = await api.getVideoTrainings()
    video.value = (data.videoTrainings || []).find(v => String(v.id) === route.params.id)
    if (!video.value) {
      loadError.value = t('videoWatchView.errorNotFound')
      return
    }
    const videoId = extractYouTubeId(video.value.youtubeUrl)
    if (!videoId) {
      loadError.value = t('videoWatchView.errorPlayerLoad')
      return
    }
    await loadIframeApi()
    player = new window.YT.Player('youtube-player', {
      videoId,
      playerVars: { rel: 0 },
      events: {
        onReady: () => { playerReady.value = true },
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.ENDED) onVideoEnded()
        },
      },
    })
  } catch (e) {
    loadError.value = t('videoWatchView.errorPlayerLoad')
  }
})
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <h1 class="font-display text-xl font-semibold text-white">{{ video?.title || t('videoWatchView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="loadError" class="text-coral text-sm mb-4">{{ loadError }}</p>
      <div v-if="video" class="bg-white rounded-xl2 p-4 shadow-sm">
        <div class="aspect-video w-full">
          <div id="youtube-player" class="w-full h-full" />
        </div>
        <p class="text-slate text-xs mt-3">{{ t('videoWatchView.watchToContinue') }}</p>
      </div>
    </main>
  </div>
</template>
