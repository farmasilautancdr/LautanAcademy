<script setup>
// Company-wide staff directory, Supervisor-only — the only place the
// Pharmacist tag can be set. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const { t } = useI18n()

const staff = ref([])
const loading = ref(true)
const status = ref('')
const statusOk = ref(true)
const outletFilter = ref('ALL')

// Derived from the loaded staff list itself, not a separate outlets fetch —
// guarantees the dropdown only ever offers outlets that actually have staff
// on record, and needs no extra request (YAGNI, same reasoning useOutlets.js
// documents for its own scope).
const outletOptions = computed(() => [...new Set(staff.value.map(s => s.outlet))].sort())
const filteredStaff = computed(() => outletFilter.value === 'ALL' ? staff.value : staff.value.filter(s => s.outlet === outletFilter.value))

async function load() {
  loading.value = true
  try {
    const data = await api.getAllStaffPharmacistTags()
    staff.value = data.staff || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}
load()

async function toggle(row) {
  status.value = ''
  try {
    await api.setStaffPharmacistTag(row.id, !row.isPharmacist)
    await load()
  } catch (err) {
    status.value = err.message || t('supervisorPharmacistTagView.errorUpdateFailed')
    statusOk.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorPharmacistTagView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="status" class="text-sm mb-3" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
      <div v-if="loading" class="text-slate text-sm">{{ t('supervisorPharmacistTagView.loading') }}</div>
      <div v-else-if="staff.length === 0" class="text-slate text-sm">{{ t('supervisorPharmacistTagView.noStaffYet') }}</div>
      <template v-else>
        <div class="mb-4">
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorPharmacistTagView.outletFilterLabel') }}</label>
          <select v-model="outletFilter" class="border border-slate/30 rounded-lg py-2 px-3">
            <option value="ALL">{{ t('supervisorPharmacistTagView.allOutlets') }}</option>
            <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>
        <div v-if="filteredStaff.length === 0" class="text-slate text-sm">{{ t('supervisorPharmacistTagView.noStaffYet') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="row in filteredStaff" :key="row.id" class="px-5 py-3 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ row.name }}<span v-if="row.idNote" class="text-slate font-normal"> ({{ row.idNote }})</span></p>
              <p class="text-xs text-slate">{{ row.outlet }} · {{ row.division }}</p>
            </div>
            <button
              type="button"
              @click="toggle(row)"
              class="text-xs font-medium hover:underline shrink-0"
              :class="row.isPharmacist ? 'text-coral' : 'text-aqua'"
            >
              {{ row.isPharmacist ? t('supervisorPharmacistTagView.untag') : t('supervisorPharmacistTagView.tag') }}
            </button>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
