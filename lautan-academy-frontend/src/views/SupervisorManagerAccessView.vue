<script setup>
// Supervisor-only: set a new master/recovery PIN per role. Write-only —
// the current value is never shown back (it's bcrypt-hashed, not
// recoverable). See docs/superpowers/specs/2026-08-06-manager-auth-design.md.
import { ref } from 'vue'
import { api } from '../api/client'

const ROLES = [
  { role: 'outlet_manager', label: 'Outlet Manager' },
  { role: 'warehouse_manager', label: 'Warehouse Manager' },
  { role: 'area_manager', label: 'Area Manager' },
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
    status.value[role] = 'Enter a new master PIN.'
    return
  }
  if (newMasterPin !== confirmMasterPin) {
    status.value[role] = 'PINs do not match.'
    return
  }
  saving.value[role] = true
  try {
    const res = await api.rotateMasterPin({ role, newMasterPin })
    if (res.status !== 'ok') throw new Error(res.error || 'Could not update.')
    pins.value[role] = ''
    confirmPins.value[role] = ''
    status.value[role] = 'Master PIN updated.'
    statusOk.value[role] = true
  } catch (err) {
    status.value[role] = err.message || 'Could not update.'
    statusOk.value[role] = false
  } finally {
    saving.value[role] = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Supervisor</p>
      <h1 class="font-display text-xl font-semibold text-white">Manager Access</h1>
    </header>

    <main class="max-w-2xl mx-auto px-6 py-8 space-y-4">
      <p class="text-slate text-sm mb-2">Set a new master PIN per role. This is the recovery/handover PIN managers use to register or re-register their outlet/region — not a login PIN itself once they've set their own password. The current value can't be shown back, only replaced.</p>

      <div v-for="r in ROLES" :key="r.role" class="bg-white rounded-xl2 p-5 shadow-sm">
        <p class="text-sm font-medium text-ink mb-2">{{ r.label }}</p>
        <form @submit.prevent="rotate(r.role)" class="flex items-center gap-2">
          <label :for="`pin-${r.role}`" class="sr-only">New master PIN for {{ r.label }}</label>
          <input
            :id="`pin-${r.role}`"
            v-model="pins[r.role]"
            type="password"
            placeholder="New master PIN"
            class="flex-1 min-w-0 border border-slate/30 rounded-lg py-2 px-3 text-sm"
          />
          <label :for="`confirm-${r.role}`" class="sr-only">Confirm new master PIN for {{ r.label }}</label>
          <input
            :id="`confirm-${r.role}`"
            v-model="confirmPins[r.role]"
            type="password"
            placeholder="Confirm master PIN"
            class="flex-1 min-w-0 border border-slate/30 rounded-lg py-2 px-3 text-sm"
          />
          <button
            type="submit"
            :disabled="saving[r.role]"
            class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shrink-0"
          >
            {{ saving[r.role] ? 'Saving...' : 'Set' }}
          </button>
        </form>
        <p v-if="status[r.role]" class="text-xs mt-2" :class="statusOk[r.role] ? 'text-aqua' : 'text-coral'">{{ status[r.role] }}</p>
      </div>
    </main>
  </div>
</template>
