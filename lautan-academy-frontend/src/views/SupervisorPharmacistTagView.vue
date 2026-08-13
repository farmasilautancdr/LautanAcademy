<script setup>
// Company-wide staff directory, Supervisor-only — the only place the
// Pharmacist tag can be set. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const { t } = useI18n()

const staff = ref([])
const loading = ref(true)
const status = ref('')
const statusOk = ref(true)

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
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <div v-for="row in staff" :key="row.id" class="px-5 py-3 flex items-center justify-between gap-3">
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
    </main>
  </div>
</template>
