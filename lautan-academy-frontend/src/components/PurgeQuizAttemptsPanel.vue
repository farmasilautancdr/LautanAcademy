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

// Quiz attempts span both divisions — retail outlets plus the 4 fixed
// warehouse locations (warehouse only ever has AI Practice attempts, but
// this panel doesn't filter by division so both lists apply).
const { allOutletCodes: OUTLET_OPTIONS } = useOutlets()

const type = ref('standard') // 'standard' | 'ai'
const outletFilter = ref('')
const nameFilter = ref('')
const topicFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
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
    const params = { type: type.value }
    if (outletFilter.value.trim()) params.outlet = outletFilter.value.trim()
    if (nameFilter.value.trim()) params.name = nameFilter.value.trim()
    if (topicFilter.value.trim()) params.topic = topicFilter.value.trim()
    if (dateFrom.value) params.dateFrom = dateFrom.value
    if (dateTo.value) params.dateTo = dateTo.value
    const data = await api.masterSearchQuizAttempts(params, masterAuth.token)
    results.value = data.attempts || []
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.quizAttempts.errorSearchFailed')
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
  return [
    { label: t('masterPanel.dataPurge.quizAttempts.breakdownAttempts'), count: rows.length },
  ]
}

function legacyWarning() {
  const rows = results.value.filter(r => selected.value.has(r.id))
  const legacyCount = rows.filter(r => !r.hasAttemptId).length
  return legacyCount ? t('masterPanel.dataPurge.quizAttempts.legacyWarning', { count: legacyCount }) : ''
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = await api.masterDeleteQuizAttempts(type.value, ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.quizAttempts.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.quizAttempts.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-2 text-sm">
      <button type="button" @click="type = 'standard'" class="px-3 py-1.5 rounded-full" :class="type === 'standard' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.quizAttempts.typeStandard') }}
      </button>
      <button type="button" @click="type = 'ai'" class="px-3 py-1.5 rounded-full" :class="type === 'ai' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.quizAttempts.typeAi') }}
      </button>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap gap-2 items-end">
      <select v-model="outletFilter" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.dataPurge.quizAttempts.outletAll') }}</option>
        <option v-for="o in OUTLET_OPTIONS" :key="o" :value="o">{{ o }}</option>
      </select>
      <input v-model="nameFilter" type="text" :placeholder="t('masterPanel.dataPurge.quizAttempts.namePlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="topicFilter" type="text" :placeholder="t('masterPanel.dataPurge.quizAttempts.topicPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <label class="text-xs text-slate">{{ t('masterPanel.dataPurge.quizAttempts.dateFromLabel') }}
        <input v-model="dateFrom" type="date" class="block border border-slate/30 rounded-lg py-1.5 px-2 text-sm" />
      </label>
      <label class="text-xs text-slate">{{ t('masterPanel.dataPurge.quizAttempts.dateToLabel') }}
        <input v-model="dateTo" type="date" class="block border border-slate/30 rounded-lg py-1.5 px-2 text-sm" />
      </label>
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.quizAttempts.searching') : t('masterPanel.dataPurge.quizAttempts.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[40rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colOutlet') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colName') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colTopic') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colScore') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.quizAttempts.colDate') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in paginatedResults" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <td class="p-2 text-ink">{{ r.outlet }}</td>
            <td class="p-2 text-ink">{{ r.name }}</td>
            <td class="p-2 text-ink">{{ r.topic }}</td>
            <td class="p-2 text-slate text-xs">
              {{ r.percentage }}
              <span v-if="!r.hasAttemptId" class="ml-1 text-coral">{{ t('masterPanel.dataPurge.quizAttempts.legacyBadge') }}</span>
            </td>
            <td class="p-2 text-slate text-xs">{{ new Date(r.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
      <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.quizAttempts.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.quizAttempts.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.dataPurge.quizAttempts.confirmTitle')"
      :breakdown="breakdown()"
      :warning="legacyWarning()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
