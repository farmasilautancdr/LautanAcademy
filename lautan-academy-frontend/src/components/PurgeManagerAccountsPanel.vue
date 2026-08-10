<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const roleFilter = ref('')
const scopeKeyFilter = ref('')
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
    const params = {}
    if (roleFilter.value) params.role = roleFilter.value
    if (scopeKeyFilter.value.trim()) params.scopeKey = scopeKeyFilter.value.trim()
    const data = await api.masterSearchManagerAccounts(params, masterAuth.token)
    results.value = data.accounts || []
  } catch (err) {
    searchError.value = err.message || t('masterPanel.dataPurge.managerAccounts.errorSearchFailed')
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
  return [
    { label: t('masterPanel.dataPurge.managerAccounts.breakdownAccounts'), count: selected.value.size },
  ]
}

async function confirmDelete() {
  deleting.value = true
  status.value = ''
  try {
    const ids = Array.from(selected.value)
    const data = await api.masterDeleteManagerAccounts(ids, masterAuth.token)
    status.value = t('masterPanel.dataPurge.managerAccounts.successDeleted', { count: data.deletedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.dataPurge.managerAccounts.errorDeleteFailed')
    statusOk.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <form @submit.prevent="search" class="flex flex-wrap gap-2">
      <select v-model="roleFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.dataPurge.managerAccounts.roleAll') }}</option>
        <option value="outlet_manager">{{ t('masterPanel.dataPurge.managerAccounts.roleOutletManager') }}</option>
        <option value="warehouse_manager">{{ t('masterPanel.dataPurge.managerAccounts.roleWarehouseManager') }}</option>
        <option value="area_manager">{{ t('masterPanel.dataPurge.managerAccounts.roleAreaManager') }}</option>
      </select>
      <input v-model="scopeKeyFilter" type="text" :placeholder="t('masterPanel.dataPurge.managerAccounts.scopeKeyPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.dataPurge.managerAccounts.searching') : t('masterPanel.dataPurge.managerAccounts.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="results.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[28rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.dataPurge.managerAccounts.colRole') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.managerAccounts.colScopeKey') }}</th>
            <th class="p-2">{{ t('masterPanel.dataPurge.managerAccounts.colCreated') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(r.id)" @change="toggle(r.id)" /></td>
            <td class="p-2 text-ink">{{ r.role }}</td>
            <td class="p-2 text-ink">{{ r.scopeKey }}</td>
            <td class="p-2 text-slate text-xs">{{ new Date(r.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!searching" class="text-slate text-xs">{{ t('masterPanel.dataPurge.managerAccounts.noResults') }}</p>

    <button
      v-if="results.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.dataPurge.managerAccounts.deleteSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.dataPurge.managerAccounts.confirmTitle')"
      :breakdown="breakdown()"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="showConfirm = false"
    />
  </div>
</template>
