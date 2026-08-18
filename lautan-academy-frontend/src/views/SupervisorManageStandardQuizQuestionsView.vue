<script setup>
// Supervisor-only CRUD over standard_questions (the quiz bank behind
// Module Quiz). Mirrors SupervisorManageQuizQuestionsView.vue (video
// quiz admin) field-for-field, with one difference: standard_questions has
// no parent "course" table, so topic is a text input backed by a <datalist>
// of existing topics rather than a closed <select> — typing an unrecognized
// name creates a brand-new module the moment its first question is saved,
// same as how ModuleQuizView.vue itself derives its topic list.
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'

const { t } = useI18n()

const allQuestions = ref([])
const loadingTopics = ref(true)
const selectedTopic = ref('')

async function loadAll() {
  loadingTopics.value = true
  try {
    const data = await api.getQuestions()
    allQuestions.value = data.questions || []
  } catch (e) {
    allQuestions.value = []
  }
  loadingTopics.value = false
}
loadAll()

const topics = computed(() => [...new Set(allQuestions.value.map(q => q.topic))].filter(Boolean).sort())
const questions = computed(() => allQuestions.value.filter(q => q.topic === selectedTopic.value))
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
      await api.updateStandardQuestion(editingId.value, payload)
    } else {
      await api.addStandardQuestion(payload)
    }
    resetForm()
    await loadAll()
  } catch (err) {
    qError.value = err.message || t('supervisorManageStandardQuizQuestionsView.errorSaveFailed')
  } finally {
    qSaving.value = false
  }
}

const deleteError = ref('')
async function removeQuestion(q) {
  deleteError.value = ''
  if (!confirm(t('supervisorManageStandardQuizQuestionsView.confirmRemove'))) return
  try {
    await api.deleteStandardQuestion(q.id)
    if (editingId.value === q.id) resetForm()
    await loadAll()
  } catch (err) {
    deleteError.value = err.message || t('supervisorManageStandardQuizQuestionsView.errorDeleteFailed')
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorManageStandardQuizQuestionsView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="mb-4">
        <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.topicLabel') }}</label>
        <div v-if="loadingTopics" class="text-slate text-sm">{{ t('supervisorManageStandardQuizQuestionsView.loading') }}</div>
        <template v-else>
          <input
            v-model="selectedTopic"
            list="standard-topics-datalist"
            type="text"
            :placeholder="t('supervisorManageStandardQuizQuestionsView.topicPlaceholder')"
            class="w-full border border-slate/30 rounded-lg py-2 px-3 bg-white"
          />
          <datalist id="standard-topics-datalist">
            <option v-for="topic in topics" :key="topic" :value="topic" />
          </datalist>
          <p v-if="topics.length === 0" class="text-xs text-slate mt-1">{{ t('supervisorManageStandardQuizQuestionsView.noTopicsYet') }}</p>
        </template>
      </div>

      <template v-if="selectedTopic">
        <p v-if="deleteError" class="text-coral text-sm mb-2">{{ deleteError }}</p>

        <div v-if="questions.length === 0" class="text-slate text-sm mb-4">{{ t('supervisorManageStandardQuizQuestionsView.noQuestionsYet') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
          <div v-for="q in paginatedQuestions" :key="q.id" class="px-5 py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ q.question_en }}</p>
              <p class="text-xs text-slate">{{ q.opt3_en === '' ? t('supervisorManageStandardQuizQuestionsView.typeTrueFalse') : t('supervisorManageStandardQuizQuestionsView.typeMcq') }}</p>
            </div>
            <div class="flex gap-3 shrink-0">
              <button @click="startEdit(q)" class="text-aqua text-xs font-medium underline">{{ t('supervisorManageStandardQuizQuestionsView.edit') }}</button>
              <button @click="removeQuestion(q)" class="text-coral text-xs font-medium underline">{{ t('supervisorManageStandardQuizQuestionsView.remove') }}</button>
            </div>
          </div>
          <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
        </div>

        <form @submit.prevent="saveQuestion" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <h2 class="font-display text-base font-semibold text-ink">
            {{ editingId ? t('supervisorManageStandardQuizQuestionsView.editingHeading') : t('supervisorManageStandardQuizQuestionsView.addingHeading') }}
          </h2>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.typeLabel') }}</label>
            <select v-model="qType" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="mcq">{{ t('supervisorManageStandardQuizQuestionsView.typeMcq') }}</option>
              <option value="tf">{{ t('supervisorManageStandardQuizQuestionsView.typeTrueFalse') }}</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.questionEnLabel') }}</label>
              <textarea v-model="qQuestionEn" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.questionMsLabel') }}</label>
              <textarea v-model="qQuestionMs" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="0" v-model="qCorrect" /> {{ t('supervisorManageStandardQuizQuestionsView.opt1EnLabel') }}
              </label>
              <input v-model="qOpt1En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.opt1MsLabel') }}</label>
              <input v-model="qOpt1Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="1" v-model="qCorrect" /> {{ t('supervisorManageStandardQuizQuestionsView.opt2EnLabel') }}
              </label>
              <input v-model="qOpt2En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.opt2MsLabel') }}</label>
              <input v-model="qOpt2Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <template v-if="qType === 'mcq'">
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="2" v-model="qCorrect" /> {{ t('supervisorManageStandardQuizQuestionsView.opt3EnLabel') }}
                </label>
                <input v-model="qOpt3En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.opt3MsLabel') }}</label>
                <input v-model="qOpt3Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="3" v-model="qCorrect" /> {{ t('supervisorManageStandardQuizQuestionsView.opt4EnLabel') }}
                </label>
                <input v-model="qOpt4En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageStandardQuizQuestionsView.opt4MsLabel') }}</label>
                <input v-model="qOpt4Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
            </template>
          </div>

          <p v-if="qError" class="text-coral text-sm">{{ qError }}</p>
          <div class="flex gap-2">
            <button type="submit" :disabled="qSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
              {{ qSaving ? t('supervisorManageStandardQuizQuestionsView.saving') : (editingId ? t('supervisorManageStandardQuizQuestionsView.saveChanges') : t('supervisorManageStandardQuizQuestionsView.addQuestion')) }}
            </button>
            <button v-if="editingId" type="button" @click="resetForm" class="text-slate text-sm font-medium px-3">
              {{ t('supervisorManageStandardQuizQuestionsView.cancelEdit') }}
            </button>
          </div>
        </form>
      </template>
    </main>
  </div>
</template>
