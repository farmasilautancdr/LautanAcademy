<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import { useOutlets } from '../composables/useOutlets'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const ACTOR_TYPES = ['master', 'outlet_manager', 'warehouse_manager', 'area_manager', 'supervisor']

// actor_key means a different thing per actor type — outlet code,
// warehouse location, or area id — same pattern as
// PurgeManagerAccountsPanel's scope_key. 'All' / supervisor / master have
// no single list, so they fall back to free text.
const { retailOutlets: RETAIL_OUTLETS, warehouseLocations: WAREHOUSE_LOCATIONS, areaIds: AREA_IDS } = useOutlets()

const actorType = ref('')
const actorKey = ref('')

const actorKeyOptions = computed(() => {
  if (actorType.value === 'outlet_manager') return RETAIL_OUTLETS.value
  if (actorType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS.value
  if (actorType.value === 'area_manager') return AREA_IDS.value
  return null
})

watch(actorType, () => { actorKey.value = '' })
const action = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const entries = ref([])
const searching = ref(false)
const searchError = ref('')
const searched = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  try {
    const params = {}
    if (actorType.value) params.actorType = actorType.value
    if (actorKey.value.trim()) params.actorKey = actorKey.value.trim()
    if (action.value.trim()) params.action = action.value.trim()
    if (dateFrom.value) params.dateFrom = dateFrom.value
    if (dateTo.value) params.dateTo = dateTo.value
    const data = await api.searchAuditLog(params, masterAuth.token)
    entries.value = data.entries || []
    searched.value = true
  } catch (err) {
    searchError.value = err.message || t('masterPanel.auditLogs.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

search()
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.auditLogs.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.auditLogs.title') }}</h3>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <select v-model="actorType" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.auditLogs.filterActorTypeAll') }}</option>
        <option v-for="opt in ACTOR_TYPES" :key="opt" :value="opt">{{ opt }}</option>
      </select>
      <select v-if="actorKeyOptions" v-model="actorKey" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.auditLogs.filterActorKeyAll') }}</option>
        <option v-for="o in actorKeyOptions" :key="o" :value="o">{{ o }}</option>
      </select>
      <input v-else v-model="actorKey" type="text" :placeholder="t('masterPanel.auditLogs.filterActorKeyPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="action" type="text" :placeholder="t('masterPanel.auditLogs.filterActionPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="dateFrom" type="date" class="border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="dateTo" type="date" class="border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.auditLogs.searching') : t('masterPanel.auditLogs.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="entries.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[40rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2">{{ t('masterPanel.auditLogs.colTime') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colActor') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colAction') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colSummary') }}</th>
            <th class="p-2">{{ t('masterPanel.auditLogs.colCount') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id" class="border-b border-seafoam last:border-0">
            <td class="p-2 text-slate text-xs whitespace-nowrap">{{ new Date(e.createdAt).toLocaleString() }}</td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ e.actorType }}/{{ e.actorKey }}</td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ e.action }}</td>
            <td class="p-2 text-ink text-xs">{{ e.summary }}</td>
            <td class="p-2 text-slate text-xs">{{ e.affectedCount ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="searched && !searching" class="text-slate text-xs">{{ t('masterPanel.auditLogs.noResults') }}</p>
  </div>
</template>
