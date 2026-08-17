<script setup>
// Supervisor-only CRUD over content_questions (the quiz bank behind
// Browse Courses' quiz_required reading entries). Direct copy of
// SupervisorManageQuizQuestionsView.vue's shape — topic is picked from a
// dropdown of real quiz_required content topics, not free text;
// content_questions.topic is a plain string match with no FK, a typo
// would silently orphan the question. See
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'

const { t } = useI18n()

const topics = ref([])
const loadingTopics = ref(true)
const selectedTopic = ref('')

const questions = ref([])
const loadingQuestions = ref(false)
const { currentPage, totalPages, paginatedItems: paginatedQuestions, next, prev } = usePagination(questions)

const editingId = ref(null) // null = add mode, otherwise the id being edited
const qType = ref('mcq') // 'mcq' | 'tf'
const qQuestionEn = ref('')
const qQuestionMs = ref('')
const qOpt1En = ref('')
const qOpt2En = ref('')
const qOpt3En = ref('')
const qOpt4En = ref('')
const qOpt1Ms = ref('')
const qOpt2Ms = ref('')
const qOpt3Ms = ref('')
const qOpt4Ms = ref('')
const qCorrect = ref(0)
const qError = ref('')
const qSaving = ref(false)

async function loadTopics() {
  loadingTopics.value = true
  try {
    const data = await api.getContent()
    topics.value = [...new Set((data.content || []).filter(c => c.QuizRequired).map(c => c.Topic))].filter(Boolean).sort()
  } catch (e) {
    topics.value = []
  }
  loadingTopics.value = false
}
loadTopics()

async function loadQuestions() {
  if (!selectedTopic.value) {
    questions.value = []
    return
  }
  loadingQuestions.value = true
  try {
    const data = await api.getContentQuestions(selectedTopic.value)
    questions.value = data.questions || []
  } catch (e) {
    questions.value = []
  }
  loadingQuestions.value = false
}
watch(selectedTopic, loadQuestions)

function resetForm() {
  editingId.value = null
  qType.value = 'mcq'
  qQuestionEn.value = ''
  qQuestionMs.value = ''
  qOpt1En.value = ''
  qOpt2En.value = ''
  qOpt3En.value = ''
  qOpt4En.value = ''
  qOpt1Ms.value = ''
  qOpt2Ms.value = ''
  qOpt3Ms.value = ''
  qOpt4Ms.value = ''
  qCorrect.value = 0
  qError.value = ''
}

function startEdit(q) {
  editingId.value = q.id
  qType.value = q.opt3_en === '' && q.opt4_en === '' ? 'tf' : 'mcq'
  qQuestionEn.value = q.question_en
  qQuestionMs.value = q.question_ms
  qOpt1En.value = q.opt1_en || ''
  qOpt2En.value = q.opt2_en || ''
  qOpt3En.value = q.opt3_en || ''
  qOpt4En.value = q.opt4_en || ''
  qOpt1Ms.value = q.opt1_ms || ''
  qOpt2Ms.value = q.opt2_ms || ''
  qOpt3Ms.value = q.opt3_ms || ''
  qOpt4Ms.value = q.opt4_ms || ''
  qCorrect.value = 0 // backend never sends `correct` in the list response; Supervisor re-picks it when editing
  qError.value = ''
}

function buildPayload() {
  return {
    type: qType.value,
    topic: selectedTopic.value,
    question_en: qQuestionEn.value.trim(),
    question_ms: qQuestionMs.value.trim(),
    opt1_en: qOpt1En.value.trim(),
    opt2_en: qOpt2En.value.trim(),
    opt3_en: qType.value === 'mcq' ? qOpt3En.value.trim() : '',
    opt4_en: qType.value === 'mcq' ? qOpt4En.value.trim() : '',
    opt1_ms: qOpt1Ms.value.trim(),
    opt2_ms: qOpt2Ms.value.trim(),
    opt3_ms: qType.value === 'mcq' ? qOpt3Ms.value.trim() : '',
    opt4_ms: qType.value === 'mcq' ? qOpt4Ms.value.trim() : '',
    correct: qCorrect.value,
  }
}

async function saveQuestion() {
  qError.value = ''
  qSaving.value = true
  try {
    const payload = buildPayload()
    if (editingId.value) {
      await api.updateContentQuestion(editingId.value, payload)
    } else {
      await api.addContentQuestion(payload)
    }
    resetForm()
    await loadQuestions()
  } catch (err) {
    qError.value = err.message || t('supervisorManageContentQuizQuestionsView.errorSaveFailed')
  } finally {
    qSaving.value = false
  }
}

const deleteError = ref('')
async function removeQuestion(q) {
  deleteError.value = ''
  if (!confirm(t('supervisorManageContentQuizQuestionsView.confirmRemove'))) return
  try {
    await api.deleteContentQuestion(q.id)
    if (editingId.value === q.id) resetForm()
    await loadQuestions()
  } catch (err) {
    deleteError.value = err.message || t('supervisorManageContentQuizQuestionsView.errorDeleteFailed')
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorManageContentQuizQuestionsView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="mb-4">
        <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.topicLabel') }}</label>
        <div v-if="loadingTopics" class="text-slate text-sm">{{ t('supervisorManageContentQuizQuestionsView.loading') }}</div>
        <select v-else v-model="selectedTopic" class="w-full border border-slate/30 rounded-lg py-2 px-3 bg-white">
          <option value="">{{ t('supervisorManageContentQuizQuestionsView.topicPlaceholder') }}</option>
          <option v-for="topic in topics" :key="topic" :value="topic">{{ topic }}</option>
        </select>
        <p v-if="!loadingTopics && topics.length === 0" class="text-xs text-slate mt-1">{{ t('supervisorManageContentQuizQuestionsView.noTopicsYet') }}</p>
      </div>

      <template v-if="selectedTopic">
        <p v-if="deleteError" class="text-coral text-sm mb-2">{{ deleteError }}</p>

        <div v-if="loadingQuestions" class="text-slate text-sm">{{ t('supervisorManageContentQuizQuestionsView.loading') }}</div>
        <div v-else-if="questions.length === 0" class="text-slate text-sm mb-4">{{ t('supervisorManageContentQuizQuestionsView.noQuestionsYet') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
          <div v-for="q in paginatedQuestions" :key="q.id" class="px-5 py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ q.question_en }}</p>
              <p class="text-xs text-slate">{{ q.opt3_en === '' ? t('supervisorManageContentQuizQuestionsView.typeTrueFalse') : t('supervisorManageContentQuizQuestionsView.typeMcq') }}</p>
            </div>
            <div class="flex gap-3 shrink-0">
              <button @click="startEdit(q)" class="text-aqua text-xs font-medium underline">{{ t('supervisorManageContentQuizQuestionsView.edit') }}</button>
              <button @click="removeQuestion(q)" class="text-coral text-xs font-medium underline">{{ t('supervisorManageContentQuizQuestionsView.remove') }}</button>
            </div>
          </div>
          <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
        </div>

        <form @submit.prevent="saveQuestion" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <h2 class="font-display text-base font-semibold text-ink">
            {{ editingId ? t('supervisorManageContentQuizQuestionsView.editingHeading') : t('supervisorManageContentQuizQuestionsView.addingHeading') }}
          </h2>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.typeLabel') }}</label>
            <select v-model="qType" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="mcq">{{ t('supervisorManageContentQuizQuestionsView.typeMcq') }}</option>
              <option value="tf">{{ t('supervisorManageContentQuizQuestionsView.typeTrueFalse') }}</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.questionEnLabel') }}</label>
              <textarea v-model="qQuestionEn" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.questionMsLabel') }}</label>
              <textarea v-model="qQuestionMs" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="0" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt1EnLabel') }}
              </label>
              <input v-model="qOpt1En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt1MsLabel') }}</label>
              <input v-model="qOpt1Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="1" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt2EnLabel') }}
              </label>
              <input v-model="qOpt2En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt2MsLabel') }}</label>
              <input v-model="qOpt2Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <template v-if="qType === 'mcq'">
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="2" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt3EnLabel') }}
                </label>
                <input v-model="qOpt3En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt3MsLabel') }}</label>
                <input v-model="qOpt3Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="3" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt4EnLabel') }}
                </label>
                <input v-model="qOpt4En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt4MsLabel') }}</label>
                <input v-model="qOpt4Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
            </template>
          </div>

          <p v-if="qError" class="text-coral text-sm">{{ qError }}</p>
          <div class="flex gap-2">
            <button type="submit" :disabled="qSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
              {{ qSaving ? t('supervisorManageContentQuizQuestionsView.saving') : (editingId ? t('supervisorManageContentQuizQuestionsView.saveChanges') : t('supervisorManageContentQuizQuestionsView.addQuestion')) }}
            </button>
            <button v-if="editingId" type="button" @click="resetForm" class="text-slate text-sm font-medium px-3">
              {{ t('supervisorManageContentQuizQuestionsView.cancelEdit') }}
            </button>
          </div>
        </form>
      </template>
    </main>
  </div>
</template>
