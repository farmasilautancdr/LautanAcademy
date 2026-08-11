<script setup>
// Master-only: pick a staff/manager target and start viewing the app as
// them (Subsystem H). Target = {scopeType, scopeKey}, the exact shape a
// real login already produces — no new identity concept. Supervisor and
// Master are not offered (see design spec). See
// docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useMasterAuthStore } from '../store/masterAuth'
import { useOutlets } from '../composables/useOutlets'

const emit = defineEmits(['close', 'started'])
const { t } = useI18n()
const auth = useAuthStore()
const masterAuth = useMasterAuthStore()

const { retailOutlets: RETAIL_OUTLETS, warehouseLocations: WAREHOUSE_LOCATIONS, areaIds: AREA_IDS } = useOutlets()

const targetType = ref('staff_retail')
const outlet = ref('')
const nameQuery = ref('')
const staffResults = ref([])
const picked = ref(null)
const searching = ref(false)
const starting = ref(false)
const error = ref('')

const isStaffType = computed(() => targetType.value === 'staff_retail' || targetType.value === 'staff_warehouse')
const outletOptions = computed(() => {
  if (targetType.value === 'staff_warehouse' || targetType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS.value
  if (targetType.value === 'area_manager') return AREA_IDS.value
  return RETAIL_OUTLETS.value
})

function resetPick() {
  outlet.value = ''
  nameQuery.value = ''
  staffResults.value = []
  picked.value = null
  error.value = ''
}

async function searchStaff() {
  if (!outlet.value) return
  searching.value = true
  picked.value = null
  try {
    const division = targetType.value === 'staff_warehouse' ? 'warehouse' : 'retail'
    const data = await api.masterSearchStaffForPurge({ outlet: outlet.value, name: nameQuery.value }, masterAuth.token)
    staffResults.value = (data.staff || []).filter(s => s.division === division)
  } catch (err) {
    error.value = err.message || t('masterPanel.impersonation.errorStartFailed')
  } finally {
    searching.value = false
  }
}

function scopeKeyFor() {
  if (isStaffType.value) return picked.value ? `${picked.value.outlet}|${picked.value.name}` : ''
  return outlet.value
}

async function start() {
  error.value = ''
  const scopeKey = scopeKeyFor()
  if (!scopeKey) {
    error.value = t('masterPanel.impersonation.errorSelectTarget')
    return
  }
  starting.value = true
  try {
    const data = await api.masterImpersonateStart(targetType.value, scopeKey, masterAuth.token)
    const staff = isStaffType.value
      ? { name: picked.value.name, outlet: picked.value.outlet, division: targetType.value === 'staff_warehouse' ? 'warehouse' : 'retail' }
      : null
    const manager = !isStaffType.value
      ? { role: targetType.value, outlet: scopeKey, label: scopeKey }
      : null
    auth.startImpersonation(data.token, staff, manager, data.sessionId)
    emit('started')
  } catch (err) {
    error.value = err.message || t('masterPanel.impersonation.errorStartFailed')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.impersonation.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.impersonation.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.impersonation.intro') }}</p>
    </div>

    <div>
      <label class="block text-sm font-medium text-ink mb-1">{{ t('masterPanel.impersonation.targetType') }}</label>
      <select v-model="targetType" @change="resetPick" class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="staff_retail">{{ t('masterPanel.impersonation.targetTypeStaffRetail') }}</option>
        <option value="staff_warehouse">{{ t('masterPanel.impersonation.targetTypeStaffWarehouse') }}</option>
        <option value="outlet_manager">{{ t('masterPanel.impersonation.targetTypeOutletManager') }}</option>
        <option value="warehouse_manager">{{ t('masterPanel.impersonation.targetTypeWarehouseManager') }}</option>
        <option value="area_manager">{{ t('masterPanel.impersonation.targetTypeAreaManager') }}</option>
      </select>
    </div>

    <div>
      <label class="block text-sm font-medium text-ink mb-1">
        {{ targetType === 'area_manager' ? t('masterPanel.impersonation.areaLabel') : t('masterPanel.impersonation.outletLabel') }}
      </label>
      <select v-model="outlet" @change="picked = null; staffResults = []" class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.impersonation.selectOutlet') }}</option>
        <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
      </select>
    </div>

    <template v-if="isStaffType">
      <form @submit.prevent="searchStaff" class="flex items-center gap-2">
        <input v-model="nameQuery" type="text" :placeholder="t('masterPanel.impersonation.staffSearchPlaceholder')" class="flex-1 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
        <button type="submit" :disabled="!outlet || searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
          {{ searching ? t('masterPanel.impersonation.searching') : t('masterPanel.impersonation.search') }}
        </button>
      </form>
      <p v-if="!searching && outlet && staffResults.length === 0" class="text-slate text-xs">{{ t('masterPanel.impersonation.noStaffResults') }}</p>
      <div v-if="staffResults.length" class="border border-seafoam rounded-lg divide-y divide-seafoam max-h-48 overflow-y-auto">
        <label v-for="s in staffResults" :key="s.id" class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
          <input type="radio" :checked="picked && picked.name === s.name && picked.outlet === s.outlet" @change="picked = { outlet: s.outlet, name: s.name }" />
          {{ s.name }} <span class="text-slate text-xs">({{ s.outlet }})</span>
        </label>
      </div>
    </template>

    <p v-if="error" class="text-coral text-sm">{{ error }}</p>

    <button type="button" @click="start" :disabled="starting" class="w-full bg-aqua text-white font-medium py-3 rounded-lg disabled:opacity-60">
      {{ starting ? t('masterPanel.impersonation.starting') : t('masterPanel.impersonation.start') }}
    </button>
  </div>
</template>
