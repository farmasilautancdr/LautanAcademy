<script setup>
// Supervisor-only: set a new master/recovery PIN per role. Write-only —
// the current value is never shown back (it's bcrypt-hashed, not
// recoverable). See docs/superpowers/specs/2026-08-06-manager-auth-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import PasswordField from '../components/PasswordField.vue'

const { t } = useI18n()

const ROLES = [
  { role: 'outlet_manager', labelKey: 'sidebar.roleOutletManager' },
  { role: 'warehouse_manager', labelKey: 'sidebar.roleWarehouseManager' },
  { role: 'area_manager', labelKey: 'sidebar.roleAreaManager' },
]

const pins = ref({ outlet_manager: '', warehouse_manager: '', area_manager: '' })
const confirmPins = ref({ outlet_manager: '', warehouse_manager: '', area_manager: '' })
const saving = ref({ outlet_manager: false, warehouse_manager: false, area_manager: false })
const status = ref({ outlet_manager: '', warehouse_manager: '', area_manager: '' })
const statusOk = ref({ outlet_manager: false, warehouse_manager: false, area_manager: false })

async function rotate(role) {
  status.value[role] = ''
  statusOk.value[role] = false
  const newMasterPin = pins.value[role].trim()
  const confirmMasterPin = confirmPins.value[role].trim()
  if (!newMasterPin) {
    status.value[role] = t('supervisorManagerAccessView.errorEnterPin')
    return
  }
  if (newMasterPin !== confirmMasterPin) {
    status.value[role] = t('supervisorManagerAccessView.errorPinsMismatch')
    return
  }
  saving.value[role] = true
  try {
    const res = await api.rotateMasterPin({ role, newMasterPin })
    if (res.status !== 'ok') throw new Error(res.error || t('supervisorManagerAccessView.errorUpdateFailed'))
    pins.value[role] = ''
    confirmPins.value[role] = ''
    status.value[role] = t('supervisorManagerAccessView.successUpdated')
    statusOk.value[role] = true
  } catch (err) {
    status.value[role] = err.message || t('supervisorManagerAccessView.errorUpdateFailed')
    statusOk.value[role] = false
  } finally {
    saving.value[role] = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorManagerAccessView.title') }}</h1>
    </header>

    <main class="max-w-2xl mx-auto px-6 py-8 space-y-4">
      <p class="text-slate text-sm mb-2">{{ t('supervisorManagerAccessView.intro') }}</p>

      <div v-for="r in ROLES" :key="r.role" class="bg-white rounded-xl2 p-5 shadow-sm">
        <p class="text-sm font-medium text-ink mb-2">{{ t(r.labelKey) }}</p>
        <form @submit.prevent="rotate(r.role)" class="flex items-center gap-2">
          <label :for="`pin-${r.role}`" class="sr-only">{{ t('supervisorManagerAccessView.newPinSrLabel', { role: t(r.labelKey) }) }}</label>
          <PasswordField
            :id="`pin-${r.role}`"
            v-model="pins[r.role]"
            :placeholder="t('supervisorManagerAccessView.newPinPlaceholder')"
            class="flex-1 min-w-0"
            input-class="w-full border border-slate/30 rounded-lg py-2 pl-3 pr-9 text-sm"
          />
          <label :for="`confirm-${r.role}`" class="sr-only">{{ t('supervisorManagerAccessView.confirmPinSrLabel', { role: t(r.labelKey) }) }}</label>
          <PasswordField
            :id="`confirm-${r.role}`"
            v-model="confirmPins[r.role]"
            :placeholder="t('supervisorManagerAccessView.confirmPinPlaceholder')"
            class="flex-1 min-w-0"
            input-class="w-full border border-slate/30 rounded-lg py-2 pl-3 pr-9 text-sm"
          />
          <button
            type="submit"
            :disabled="saving[r.role]"
            class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shrink-0"
          >
            {{ saving[r.role] ? t('supervisorManagerAccessView.saving') : t('supervisorManagerAccessView.set') }}
          </button>
        </form>
        <p v-if="status[r.role]" class="text-xs mt-2" :class="statusOk[r.role] ? 'text-aqua' : 'text-coral'">{{ status[r.role] }}</p>
      </div>
    </main>
  </div>
</template>
