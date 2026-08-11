<script setup>
// Master-only: add/deactivate/reactivate areas and outlets. No bulk-delete
// modal here — every mutation is a single-row create or active-toggle
// (see Global Constraints: no hard delete, no rename). See
// docs/superpowers/specs/2026-08-11-outlet-management-design.md.
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const areas = ref([])
const outlets = ref([])
const loading = ref(true)
const loadError = ref('')
const status = ref('')
const statusOk = ref(false)

const newAreaId = ref('')
const newAreaLabel = ref('')
const addingArea = ref(false)

const newOutletCode = ref('')
const newOutletDivision = ref('retail')
const newOutletAreaId = ref('')
const addingOutlet = ref(false)

const warehouseOutlets = computed(() => outlets.value.filter((o) => o.division === 'warehouse'))
const outletsByArea = computed(() => {
  const map = {}
  for (const a of areas.value) map[a.id] = []
  for (const o of outlets.value) {
    if (o.division === 'retail' && o.areaId) (map[o.areaId] ||= []).push(o)
  }
  return map
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api.masterGetOutlets(masterAuth.token)
    areas.value = data.areas
    outlets.value = data.outlets
  } catch (err) {
    loadError.value = err.message || t('masterPanel.outlets.errorLoadFailed')
  } finally {
    loading.value = false
  }
}

async function addArea() {
  if (!newAreaId.value.trim() || !newAreaLabel.value.trim()) return
  addingArea.value = true
  status.value = ''
  try {
    await api.masterCreateArea({ id: newAreaId.value.trim(), label: newAreaLabel.value.trim() }, masterAuth.token)
    status.value = t('masterPanel.outlets.successAreaAdded', { id: newAreaId.value.trim() })
    statusOk.value = true
    newAreaId.value = ''
    newAreaLabel.value = ''
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorAddFailed')
    statusOk.value = false
  } finally {
    addingArea.value = false
  }
}

async function addOutlet() {
  if (!newOutletCode.value.trim()) return
  if (newOutletDivision.value === 'retail' && !newOutletAreaId.value) return
  addingOutlet.value = true
  status.value = ''
  try {
    await api.masterCreateOutlet(
      {
        code: newOutletCode.value.trim(),
        division: newOutletDivision.value,
        areaId: newOutletDivision.value === 'retail' ? newOutletAreaId.value : null,
      },
      masterAuth.token
    )
    status.value = t('masterPanel.outlets.successOutletAdded', { code: newOutletCode.value.trim() })
    statusOk.value = true
    newOutletCode.value = ''
    newOutletAreaId.value = ''
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorAddFailed')
    statusOk.value = false
  } finally {
    addingOutlet.value = false
  }
}

async function toggleOutlet(outlet) {
  status.value = ''
  try {
    await api.masterUpdateOutlet(outlet.code, { active: !outlet.active }, masterAuth.token)
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorUpdateFailed')
    statusOk.value = false
  }
}

async function toggleArea(area) {
  status.value = ''
  try {
    await api.masterUpdateArea(area.id, { active: !area.active }, masterAuth.token)
    await load()
  } catch (err) {
    status.value = err.message || t('masterPanel.outlets.errorUpdateFailed')
    statusOk.value = false
  }
}

load()
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.outlets.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.outlets.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.outlets.intro') }}</p>
    </div>

    <p v-if="loadError" class="text-coral text-xs">{{ loadError }}</p>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <div v-if="!loading" class="space-y-3">
      <div v-for="area in areas" :key="area.id" class="border border-seafoam rounded-lg p-3" :class="!area.active && 'opacity-50'">
        <div class="flex items-center justify-between">
          <span class="font-medium text-ink text-sm">{{ area.id }} - {{ area.label }}</span>
          <button type="button" @click="toggleArea(area)" class="text-xs font-medium hover:underline" :class="area.active ? 'text-coral' : 'text-aqua'">
            {{ area.active ? t('masterPanel.outlets.deactivate') : t('masterPanel.outlets.reactivate') }}
          </button>
        </div>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li v-for="o in outletsByArea[area.id]" :key="o.code" class="text-xs px-2 py-1 rounded border border-slate/30" :class="!o.active && 'opacity-50 line-through'">
            {{ o.code }}
            <button type="button" @click="toggleOutlet(o)" class="ml-1 hover:underline" :class="o.active ? 'text-coral' : 'text-aqua'">
              {{ o.active ? t('masterPanel.outlets.deactivate') : t('masterPanel.outlets.reactivate') }}
            </button>
          </li>
        </ul>
      </div>

      <div class="border border-seafoam rounded-lg p-3">
        <span class="font-medium text-ink text-sm">{{ t('masterPanel.outlets.warehouseSection') }}</span>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li v-for="o in warehouseOutlets" :key="o.code" class="text-xs px-2 py-1 rounded border border-slate/30" :class="!o.active && 'opacity-50 line-through'">
            {{ o.code }}
            <button type="button" @click="toggleOutlet(o)" class="ml-1 hover:underline" :class="o.active ? 'text-coral' : 'text-aqua'">
              {{ o.active ? t('masterPanel.outlets.deactivate') : t('masterPanel.outlets.reactivate') }}
            </button>
          </li>
        </ul>
      </div>

      <form @submit.prevent="addArea" class="border border-seafoam rounded-lg p-3 space-y-2">
        <span class="font-medium text-ink text-sm">{{ t('masterPanel.outlets.addArea') }}</span>
        <div class="flex gap-2">
          <input v-model="newAreaId" :placeholder="t('masterPanel.outlets.areaIdPlaceholder')" class="w-24 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
          <input v-model="newAreaLabel" :placeholder="t('masterPanel.outlets.areaLabelPlaceholder')" class="flex-1 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
          <button type="submit" :disabled="addingArea" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{{ t('masterPanel.outlets.add') }}</button>
        </div>
      </form>

      <form @submit.prevent="addOutlet" class="border border-seafoam rounded-lg p-3 space-y-2">
        <span class="font-medium text-ink text-sm">{{ t('masterPanel.outlets.addOutlet') }}</span>
        <div class="flex flex-wrap gap-2">
          <input v-model="newOutletCode" :placeholder="t('masterPanel.outlets.outletCodePlaceholder')" class="w-28 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
          <select v-model="newOutletDivision" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
            <option value="retail">{{ t('masterPanel.outlets.divisionRetail') }}</option>
            <option value="warehouse">{{ t('masterPanel.outlets.divisionWarehouse') }}</option>
          </select>
          <select v-if="newOutletDivision === 'retail'" v-model="newOutletAreaId" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
            <option value="">{{ t('masterPanel.outlets.selectArea') }}</option>
            <option v-for="a in areas" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
          </select>
          <button type="submit" :disabled="addingOutlet" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{{ t('masterPanel.outlets.add') }}</button>
        </div>
      </form>
    </div>
    <p v-else class="text-slate text-xs">{{ t('masterPanel.outlets.loading') }}</p>
  </div>
</template>
