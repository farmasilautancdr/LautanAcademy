<script setup>
// Split out of AreaManagerDashboard.vue — File a Report + Filed Reports were
// sections on the same page as Standard Quiz Results. The form still needs
// results (to pick a topic + auto-show score) and staff names, loaded here
// independently since this is now a separate route.
//
// Area Manager now scopes to a whole region (see store/auth.js,
// backend config/areas.js), not one outlet. auth.manager.outlet holds the
// area id ("R1 - AMIRUL"), and auth.manager.outlets is that region's outlet
// list (client-side copy, for the picker below — the backend enforces the
// real scope independently). Staff names aren't unique across the region's
// outlets, so the form picks an outlet first, then that outlet's staff —
// same two-step pattern used elsewhere in the app, not a single dropdown
// with duplicate names in it.
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const auth = useAuthStore()
const areaLabel = auth.manager?.outlet
const regionOutlets = auth.manager?.outlets || []
const managerLabel = auth.manager?.label || 'Area Manager'

const results = ref([])
const reports = ref([])
const loading = ref(true)

async function loadAll() {
  try {
    const scoped = await api.getScopedData()
    results.value = scoped.results || []
    reports.value = scoped.reports || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}
onMounted(loadAll)

const formOutlet = ref('')
const formStaff = ref('')
const formTopic = ref('')
const gaps = ref('')
const rec = ref('')
const competency = ref('')
const productKnowledgeComments = ref('')
const isEdit = ref(false)
const submitting = ref(false)
const formError = ref('')
const formNotice = ref('')

const staffNames = ref([])
const loadingStaff = ref(false)
watch(formOutlet, async (o) => {
  formStaff.value = ''
  staffNames.value = []
  if (!o) return
  loadingStaff.value = true
  try {
    const roster = await api.getStaffNames('retail', o)
    staffNames.value = roster.staff || []
  } catch (e) { /* leave empty */ }
  loadingStaff.value = false
})

const topicsForStaff = computed(() => [...new Set(results.value.filter(r => r.Name === formStaff.value && r.Outlet === formOutlet.value).map(r => r.Topic))])
const selectedResult = computed(() => results.value.find(r => r.Name === formStaff.value && r.Outlet === formOutlet.value && r.Topic === formTopic.value))
const skillLevel = computed(() => {
  const p = parseInt(selectedResult.value?.Percentage) || 0
  if (p >= 85) return 'HIGH'
  if (p >= 71) return 'MEDIUM'
  return 'LOW'
})
const existingReport = computed(() => reports.value.find(r => r['Staff Name'] === formStaff.value && r.Outlet === formOutlet.value && r['Training Title'] === formTopic.value))

function resetForm() {
  formOutlet.value = ''
  formStaff.value = ''
  formTopic.value = ''
  gaps.value = ''
  rec.value = ''
  competency.value = ''
  productKnowledgeComments.value = ''
  isEdit.value = false
  formNotice.value = ''
}

function loadExistingForEdit() {
  const r = existingReport.value
  if (!r) return
  gaps.value = r['Performance Gaps'] || ''
  rec.value = r.Recommendations || ''
  competency.value = r.Fluency ?? ''
  productKnowledgeComments.value = r['Product Knowledge Comments'] || ''
  isEdit.value = true
  formNotice.value = ''
}

async function submitReport() {
  formError.value = ''
  formNotice.value = ''
  if (!formOutlet.value || !formStaff.value || !formTopic.value || !selectedResult.value) {
    formError.value = 'Pick an outlet, staff member, and a topic they have a quiz result for.'
    return
  }
  if (competency.value !== '' && (isNaN(competency.value) || competency.value < 0 || competency.value > 10)) {
    formError.value = 'Competency must be a mark between 0 and 10.'
    return
  }
  submitting.value = true
  try {
    const data = await api.saveReport({
      outlet: formOutlet.value,
      staffName: formStaff.value,
      topic: formTopic.value,
      manager: managerLabel,
      quizScore: selectedResult.value.Percentage,
      skillLevel: skillLevel.value,
      competency: competency.value,
      gaps: gaps.value,
      rec: rec.value,
      productKnowledgeComments: productKnowledgeComments.value,
      isEdit: isEdit.value,
    })
    if (data.status === 'duplicate') {
      const who = data.existing?.manager || 'another manager'
      const when = data.existing?.timestamp ? new Date(data.existing.timestamp).toLocaleDateString() : ''
      formNotice.value = `A report already exists for this person and topic — filed by ${who}${when ? ' on ' + when : ''}.`
      return
    }
    if (data.status === 'auth_error') {
      formError.value = "That report was filed by a different manager — you can't edit it here."
      return
    }
    resetForm()
    await loadAll()
  } catch (err) {
    formError.value = err.message || 'Could not save the report.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ managerLabel }}</p>
      <h1 class="font-display text-xl font-semibold text-white">Reviews — {{ areaLabel }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8 space-y-10">
      <section>
        <h2 class="font-display text-lg font-semibold text-ink mb-4">File a Report</h2>
        <form @submit.prevent="submitReport" class="bg-white rounded-xl2 p-5 shadow-sm space-y-4">
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Outlet</label>
            <select v-model="formOutlet" @change="formTopic = ''; formNotice = ''; isEdit = false" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="">Select outlet...</option>
              <option v-for="o in regionOutlets" :key="o" :value="o">{{ o }}</option>
            </select>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-ink mb-1">Staff</label>
              <select v-model="formStaff" :disabled="!formOutlet" @change="formTopic = ''; formNotice = ''; isEdit = false" class="w-full border border-slate/30 rounded-lg py-2 px-3 disabled:opacity-50">
                <option value="">{{ !formOutlet ? 'Select outlet first...' : loadingStaff ? 'Loading...' : 'Select staff...' }}</option>
                <option v-for="n in staffNames" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink mb-1">Topic</label>
              <select v-model="formTopic" :disabled="!formStaff" @change="formNotice = ''; isEdit = false" class="w-full border border-slate/30 rounded-lg py-2 px-3 disabled:opacity-50">
                <option value="">{{ formStaff ? (topicsForStaff.length ? 'Select topic...' : 'No quiz results yet') : 'Select staff first...' }}</option>
                <option v-for="t in topicsForStaff" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
          </div>

          <div v-if="selectedResult" class="grid grid-cols-3 gap-3 text-center">
            <div class="p-3 border border-seafoam rounded-lg">
              <p class="text-[10px] uppercase text-slate">Score</p>
              <p class="font-display font-bold text-ink">{{ selectedResult.Score }}</p>
            </div>
            <div class="p-3 border border-seafoam rounded-lg">
              <p class="text-[10px] uppercase text-slate">Accuracy</p>
              <p class="font-display font-bold text-ink">{{ selectedResult.Percentage }}</p>
            </div>
            <div class="p-3 rounded-lg text-white font-bold uppercase text-sm flex items-center justify-center"
              :class="skillLevel === 'HIGH' ? 'bg-aqua' : skillLevel === 'MEDIUM' ? 'bg-coral' : 'bg-slate'">
              {{ skillLevel }}
            </div>
          </div>

          <div v-if="existingReport && !isEdit" class="bg-aqualight/40 border border-aqua/30 rounded-lg p-3 text-sm text-deepsea flex items-center justify-between gap-3">
            <span>A report already exists for this person and topic (filed by {{ existingReport.Manager }}).</span>
            <button type="button" @click="loadExistingForEdit" class="text-aqua font-medium underline shrink-0">Edit it</button>
          </div>

          <div>
            <label class="block text-sm font-medium text-ink mb-1">Competency (0–10)</label>
            <input v-model="competency" type="number" min="0" max="10" placeholder="0-10" class="w-24 border border-slate/30 rounded-lg py-2 px-3 text-center" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Product Knowledge — comments</label>
            <textarea v-model="productKnowledgeComments" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Performance Gaps</label>
            <textarea v-model="gaps" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">Recommendations</label>
            <textarea v-model="rec" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
          </div>

          <p v-if="formError" class="text-coral text-sm">{{ formError }}</p>
          <p v-if="formNotice" class="text-slate text-sm">{{ formNotice }}</p>

          <button type="submit" :disabled="submitting" class="w-full bg-aqua text-white font-medium py-3 rounded-lg disabled:opacity-60">
            {{ submitting ? 'Saving...' : (isEdit ? 'Update Report' : 'Submit Report') }}
          </button>
        </form>
      </section>

      <section>
        <h2 class="font-display text-lg font-semibold text-ink mb-4">Filed Reports</h2>
        <div v-if="loading" class="text-slate text-sm">Loading...</div>
        <div v-else-if="reports.length === 0" class="text-slate text-sm">No reports filed yet.</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="(r, i) in reports" :key="i" class="px-5 py-3">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-ink">{{ r['Staff Name'] }} · {{ r.Outlet }} · {{ r['Training Title'] }}</p>
              <span class="text-xs text-slate">{{ new Date(r.Timestamp).toLocaleDateString() }}</span>
            </div>
            <p class="text-xs text-slate mt-0.5">Filed by {{ r.Manager }} · Competency {{ r.Fluency ?? '—' }}/10</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
