<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import { useOutlets } from '../composables/useOutlets'
import { usePagination } from '../composables/usePagination'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'
import Pagination from './Pagination.vue'

const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Staff spans both divisions — retail outlets plus the 4 fixed warehouse
// locations (same 4 values LoginView.vue's warehouse picker uses).
const { allOutletCodes: OUTLET_OPTIONS } = useOutlets()

const outletFilter = ref('')
const nameFilter = ref('')
const results = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const showConfirm = ref(false)
const deleting = ref(false)
const status = ref('')
const statusOk = ref(false)
const { currentPage, totalPages, paginatedItems: paginatedResults, next, prev } = usePagination(results)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    const params = {}
    if (outletFilter.value.trim()) params.outlet = outletFilter.value.trim()
    if (nameFilter.value.trim()) params.name = nameFilter.value.trim()
    const data = await api.masterSearchStaffForPurge(params, masterAuth.token)
    results.value = data.staff || []
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.staff.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

function toggle(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function breakdown() {
  const rows = results.value.filter(r => selected.value.has(r.id))
  const totals = { staff: rows.length, results: 0, wrongAnswers: 0, aiResults: 0, aiWrongAnswers: 0, reports: 0 }
  for (const r of rows) {
    totals.results += r.relatedCounts.results
    totals.wrongAnswers += r.relatedCounts.wrongAnswers
    totals.aiResults += r.relatedCounts.aiResults
    totals.aiWrongAnswers += r.relatedCounts.aiWrongAnswers
    totals.reports += r.relatedCounts.reports
  }
  return [
    { label: t('masterPanel.dataPurge.staff.breakdownStaff'), count: totals.staff },
    { label: t('masterPanel.dataPurge.staff.breakdownResults'), count: totals.results },
    { label: t('masterPanel.dataPurge.staff.breakdownWrongAnswers'), count: totals.wrongAnswers },
    { label: t('masterPanel.dataPurge.staff.breakdownAiResults'), count: totals.aiResults },
    { label: t('masterPanel.dataPurge.staff.breakdownAiWrongAnswers'), count: totals.aiWrongAnswers },
    { label: t('masterPanel.dataPurge.staff.breakdownReports'), count: totals.reports },
  ]
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = await api.masterDeleteStaff(ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.staff.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.staff.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <select v-model="outletFilter" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.dataPurge.staff.outletAll') }}</option>
        <option v-for="o in OUTLET_OPTIONS" :key="o" :value="o">{{ o }}</option>
      </select>
      <input v-model="nameFilter" type="text" :placeholder="t('masterPanel.dataPurge.staff.namePlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.staff.searching') : t('masterPanel.dataPurge.staff.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[36rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.staff.colOutlet') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.staff.colName') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.staff.colRelated') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in paginatedResults" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <td class="p-2 text-ink">{{ r.outlet }}</td>
            <td class="p-2 text-ink">{{ r.name }}</td>
            <td class="p-2 text-slate text-xs">
              {{ t('masterPanel.dataPurge.staff.relatedSummary', { results: r.relatedCounts.results, ai: r.relatedCounts.aiResults, reports: r.relatedCounts.reports }) }}
            </td>
          </tr>
        </tbody>
      </table>
      <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.staff.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.staff.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.dataPurge.staff.confirmTitle')"
      :breakdown="breakdown()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
