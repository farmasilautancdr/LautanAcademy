<script setup>
// Master-only: view active staff/manager sessions and force-logout one or
// several (Subsystem G). Filter/table shape mirrors MasterAuditLog.vue;
// checkbox-select + confirm-modal bulk action mirrors
// PurgeManagerAccountsPanel.vue. See
// docs/superpowers/specs/2026-08-11-master-subsystem-g-design.md.
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import { AREAS } from '../config/areas'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Master itself is never tracked (see Global Constraints) — not in this list.
const SCOPE_TYPES = ['staff_retail', 'staff_warehouse', 'outlet_manager', 'warehouse_manager', 'area_manager', 'supervisor']

const RETAIL_OUTLETS = [...new Set(AREAS.flatMap(a => a.outlets))].sort()
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const AREA_IDS = AREAS.map(a => a.id)

const scopeType = ref('')
const scopeKey = ref('')
const activeOnly = ref(true)

// staff_retail/staff_warehouse/supervisor have no clean dropdown list
// (scope_key is OUTLET|NAME for staff, always 'ALL' for supervisor) — those
// fall back to free text, same pattern MasterAuditLog.vue already uses.
const scopeKeyOptions = computed(() => {
  if (scopeType.value === 'outlet_manager') return RETAIL_OUTLETS
  if (scopeType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS
  if (scopeType.value === 'area_manager') return AREA_IDS
  return null
})
watch(scopeType, () => { scopeKey.value = '' })

const sessions = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const searched = ref(false)
const showConfirm = ref(false)
const revoking = ref(false)
const status = ref('')
const statusOk = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    const params = { activeOnly: activeOnly.value ? 'true' : 'false' }
    if (scopeType.value) params.scopeType = scopeType.value
    if (scopeKey.value.trim()) params.scopeKey = scopeKey.value.trim()
    const data = await api.masterSearchSessions(params, masterAuth.token)
    sessions.value = data.sessions || []
    searched.value = true
  } catch (err) {
    searchError.value = err.message || t('masterPanel.sessions.errorSearchFailed')
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
  return [{ label: t('masterPanel.sessions.breakdownSessions'), count: selected.value.size }]
}

async function revokeIds(ids) {
  revoking.value = true
  status.value = ''
  try {
    const data = await api.masterRevokeSessions(ids, masterAuth.token)
    status.value = t('masterPanel.sessions.successRevoked', { count: data.revokedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.sessions.errorRevokeFailed')
    statusOk.value = false
  } finally {
    revoking.value = false
  }
}

// Single-session revoke is reversible (the person just logs back in), so it
// gets a lightweight native confirm instead of the full typed-confirm modal
// — that modal is reserved for the higher-blast-radius bulk action below.
function revokeOne(session) {
  if (!window.confirm(t('masterPanel.sessions.confirmOne', { scope: `${session.scopeType}/${session.scopeKey}` }))) return
  revokeIds([session.id])
}

function revokeSelected() {
  revokeIds(Array.from(selected.value))
}

search()
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.sessions.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.sessions.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.sessions.intro') }}</p>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap items-center gap-2">
      <select v-model="scopeType" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.sessions.filterScopeTypeAll') }}</option>
        <option v-for="opt in SCOPE_TYPES" :key="opt" :value="opt">{{ opt }}</option>
      </select>
      <select v-if="scopeKeyOptions" v-model="scopeKey" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.sessions.filterScopeKeyAll') }}</option>
        <option v-for="o in scopeKeyOptions" :key="o" :value="o">{{ o }}</option>
      </select>
      <input v-else v-model="scopeKey" type="text" :placeholder="t('masterPanel.sessions.filterScopeKeyPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <label class="flex items-center gap-1.5 text-xs text-slate">
        <input v-model="activeOnly" type="checkbox" />
        {{ t('masterPanel.sessions.filterActiveOnly') }}
      </label>
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.sessions.searching') : t('masterPanel.sessions.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="sessions.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[44rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.sessions.colScopeType') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colScopeKey') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colIssued') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colExpires') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colStatus') }}</th>
            <th class="p-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(s.id)" @change="toggle(s.id)" /></td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ s.scopeType }}</td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ s.scopeKey }}</td>
            <td class="p-2 text-slate text-xs whitespace-nowrap">{{ new Date(s.issuedAt).toLocaleString() }}</td>
            <td class="p-2 text-slate text-xs whitespace-nowrap">{{ new Date(s.expiresAt).toLocaleString() }}</td>
            <td class="p-2 text-xs whitespace-nowrap" :class="s.revokedAt ? 'text-coral' : 'text-aqua'">
              {{ s.revokedAt ? t('masterPanel.sessions.statusRevoked') : t('masterPanel.sessions.statusActive') }}
            </td>
            <td class="p-2">
              <button
                v-if="!s.revokedAt"
                type="button"
                @click="revokeOne(s)"
                class="text-coral text-xs font-medium hover:underline"
              >
                {{ t('masterPanel.sessions.forceLogout') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="searched && !searching" class="text-slate text-xs">{{ t('masterPanel.sessions.noResults') }}</p>

    <button
      v-if="sessions.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.sessions.revokeSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.sessions.confirmTitle')"
      :breakdown="breakdown()"
      :loading="revoking"
      @confirm="revokeSelected"
      @cancel="showConfirm = false"
    />
  </div>
</template>
