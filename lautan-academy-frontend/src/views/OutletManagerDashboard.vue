<script setup>
// Topic can be typed free-text, or picked from existing Content entries (if
// any exist — GAS's Content sheet is empty right now, so this dropdown will
// show nothing until someone adds entries via a management UI, which
// doesn't exist yet either). Google Drive-based Resources are a separate,
// not-yet-migrated piece — see SCOPE_TRACKER.md.
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const outlet = auth.manager?.outlet

const topicLabel = ref('')
const extraNotes = ref('')
const count = ref(10)
const creating = ref(false)
const createError = ref('')

const activeQuiz = ref(null) // { passcode, topic, count, createdAt }
const remaining = ref('')
let timerHandle = null

const history = ref([])
const loadingHistory = ref(true)
const contentTopics = ref([]) // deduped list of existing Content topics

async function refreshActiveQuiz() {
  try {
    const data = await api.getActiveQuiz(outlet)
    activeQuiz.value = data.active ? data : null
  } catch (e) { activeQuiz.value = null }
}

function startCountdown() {
  if (timerHandle) clearInterval(timerHandle)
  const tick = () => {
    if (!activeQuiz.value) { remaining.value = ''; return }
    const expiresAt = new Date(activeQuiz.value.createdAt).getTime() + 60 * 60 * 1000
    const ms = expiresAt - Date.now()
    if (ms <= 0) { remaining.value = 'Expired'; activeQuiz.value = null; return }
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    remaining.value = `${mins}:${secs.toString().padStart(2, '0')}`
  }
  tick()
  timerHandle = setInterval(tick, 1000)
}

onMounted(async () => {
  await refreshActiveQuiz()
  startCountdown()
  try {
    const data = await api.getScopedData()
    history.value = [...(data.results || []), ...(data.aiResults || [])]
      .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
  } catch (e) { /* leave history empty */ }
  loadingHistory.value = false

  try {
    const data = await api.getContent()
    contentTopics.value = [...new Set((data.content || []).map(c => c.Topic))].filter(Boolean).sort()
  } catch (e) { /* leave dropdown empty */ }
})

onUnmounted(() => { if (timerHandle) clearInterval(timerHandle) })

async function createQuiz() {
  createError.value = ''
  if (!topicLabel.value.trim()) {
    createError.value = 'Enter a topic.'
    return
  }
  creating.value = true
  try {
    const data = await api.createAiQuiz({
      outlet,
      sourceType: 'topic',
      sourceValue: topicLabel.value.trim(),
      topicLabel: topicLabel.value.trim(),
      count: count.value,
      extraNotes: extraNotes.value.trim(),
      manager: `Outlet Manager - ${outlet}`,
    })
    activeQuiz.value = data
    startCountdown()
    topicLabel.value = ''
    extraNotes.value = ''
  } catch (err) {
    createError.value = err.message || 'Could not generate the quiz.'
  } finally {
    creating.value = false
  }
}

async function endQuiz() {
  if (!confirm("End this code now? Staff won't be able to join with it anymore.")) return
  try {
    await api.endQuiz(outlet)
  } catch (e) { /* best-effort */ }
  if (timerHandle) clearInterval(timerHandle)
  activeQuiz.value = null
}

function logout() {
  auth.logout()
  router.push('/manager-login')
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5 flex items-center justify-between">
      <div>
        <p class="text-aqualight text-xs">Outlet Manager</p>
        <h1 class="font-display text-xl font-semibold text-white">{{ outlet }}</h1>
      </div>
      <button @click="logout" class="text-aqualight text-sm hover:text-white transition-colors">Log out</button>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8 space-y-10">
      <section>
        <h2 class="font-display text-lg font-semibold text-ink mb-4">AI Practice Quiz</h2>

        <div v-if="activeQuiz" class="bg-white rounded-xl2 p-5 shadow-sm mb-4">
          <p class="text-xs text-slate uppercase tracking-wide">Active code</p>
          <p class="font-display text-3xl font-bold text-aqua tracking-[0.3em]">{{ activeQuiz.passcode }}</p>
          <p class="text-sm text-ink mt-1">{{ activeQuiz.topic }} · {{ activeQuiz.count }} questions</p>
          <p class="text-xs text-slate mt-1">Expires in {{ remaining }}</p>
          <button @click="endQuiz" class="mt-3 text-coral text-xs font-medium underline">End this code now</button>
        </div>

        <form @submit.prevent="createQuiz" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <div v-if="contentTopics.length">
            <label class="block text-sm font-medium text-ink mb-1">Pick existing material (optional)</label>
            <select v-model="topicLabel" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="">— or type a topic below —</option>
              <option v-for="t in contentTopics" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Topic</label>
            <input v-model="topicLabel" type="text" placeholder="e.g. Handwashing Basics"
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Notes for the AI (optional)</label>
            <input v-model="extraNotes" type="text" placeholder="Emphasize..."
              class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Question count</label>
            <input v-model.number="count" type="number" min="1" max="25"
              class="w-24 border border-slate/30 rounded-lg py-2 px-3" />
          </div>
          <p v-if="createError" class="text-coral text-sm">{{ createError }}</p>
          <button type="submit" :disabled="creating"
            class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
            {{ creating ? 'Generating...' : (activeQuiz ? 'Replace active code' : 'Generate code') }}
          </button>
        </form>
      </section>

      <section>
        <h2 class="font-display text-lg font-semibold text-ink mb-4">Outlet Results</h2>
        <div v-if="loadingHistory" class="text-slate text-sm">Loading...</div>
        <div v-else-if="history.length === 0" class="text-slate text-sm">No attempts yet.</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="(h, i) in history.slice(0, 20)" :key="i" class="flex items-center justify-between px-5 py-3">
            <div>
              <p class="text-sm font-medium text-ink">{{ h.Name }} · {{ h.Topic }}</p>
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
