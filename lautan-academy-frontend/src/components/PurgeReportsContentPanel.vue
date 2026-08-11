<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import { useOutlets } from '../composables/useOutlets'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Reports only ever target retail staff (warehouse has no report
// capability end-to-end) — retail outlets only, no warehouse locations.
const { retailOutlets: OUTLET_OPTIONS } = useOutlets()

const mode = ref('reports') // 'reports' | 'content'
const outletFilter = ref('')
const staffNameFilter = ref('')
const topicFilter = ref('')
const categoryFilter = ref('')
const results = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const showConfirm = ref(false)
const deleting = ref(false)
const status = ref('')
const statusOk = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    if (mode.value === 'reports') {
      const params = {}
      if (outletFilter.value.trim()) params.outlet = outletFilter.value.trim()
      if (staffNameFilter.value.trim()) params.staffName = staffNameFilter.value.trim()
      if (topicFilter.value.trim()) params.topic = topicFilter.value.trim()
      const data = await api.masterSearchReports(params, masterAuth.token)
      results.value = data.reports || []
    } else {
      const params = {}
      if (categoryFilter.value.trim()) params.category = categoryFilter.value.trim()
      if (topicFilter.value.trim()) params.topic = topicFilter.value.trim()
      const data = await api.masterSearchContent(params, masterAuth.token)
      results.value = data.content || []
    }
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.reportsContent.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

function switchMode(next) {
  mode.value = next
  results.value = []
  selected.value = new Set()
  status.value = ''
}

function toggle(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function breakdown() {
  const label = mode.value === 'reports'
    ? t('masterPanel.dataPurge.reportsContent.breakdownReports')
    : t('masterPanel.dataPurge.reportsContent.breakdownContent')
  return [{ label, count: selected.value.size }]
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = mode.value === 'reports'
      ? await api.masterDeleteReports(ids, masterAuth.token)
      : await api.masterDeleteContent(ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.reportsContent.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.reportsContent.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-2 text-sm">
      <button type="button" @click="switchMode('reports')" class="px-3 py-1.5 rounded-full" :class="mode === 'reports' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.reportsContent.toggleReports') }}
      </button>
      <button type="button" @click="switchMode('content')" class="px-3 py-1.5 rounded-full" :class="mode === 'content' ? 'bg-aqua text-white' : 'bg-seafoam text-ink'">
        {{ t('masterPanel.dataPurge.reportsContent.toggleContent') }}
      </button>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <template v-if="mode === 'reports'">
        <select v-model="outletFilter" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm">
          <option value="">{{ t('masterPanel.dataPurge.reportsContent.outletAll') }}</option>
          <option v-for="o in OUTLET_OPTIONS" :key="o" :value="o">{{ o }}</option>
        </select>
        <input v-model="staffNameFilter" type="text" :placeholder="t('masterPanel.dataPurge.reportsContent.staffNamePlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      </template>
      <template v-else>
        <input v-model="categoryFilter" type="text" :placeholder="t('masterPanel.dataPurge.reportsContent.categoryPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      </template>
      <input v-model="topicFilter" type="text" :placeholder="t('masterPanel.dataPurge.reportsContent.topicPlaceholder')" class="flex-1 min-w-[7rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.reportsContent.searching') : t('masterPanel.dataPurge.reportsContent.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[32rem]">
        <thead v-if="mode === 'reports'">
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colOutlet') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colStaffName') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colTopic') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colManager') }}</th>
          </tr>
        </thead>
        <thead v-else>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colCategory') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colTopic') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.reportsContent.colTitle') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <template v-if="mode === 'reports'">
              <td class="p-2 text-ink">{{ r.outlet }}</td>
              <td class="p-2 text-ink">{{ r.staffName }}</td>
              <td class="p-2 text-ink">{{ r.topic }}</td>
              <td class="p-2 text-slate text-xs">{{ r.manager }}</td>
            </template>
            <template v-else>
              <td class="p-2 text-ink">{{ r.category }}</td>
              <td class="p-2 text-ink">{{ r.topic }}</td>
              <td class="p-2 text-slate text-xs">{{ r.title }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.reportsContent.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.reportsContent.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="mode === 'reports' ? t('masterPanel.dataPurge.reportsContent.confirmTitleReports') : t('masterPanel.dataPurge.reportsContent.confirmTitleContent')"
      :breakdown="breakdown()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
