<script setup>
// Shared by Outlet Manager and Warehouse Manager dashboards — same feature,
// only the division param differs. No passcode lookup (GAS's version shows
// managers the plaintext PIN; this backend hashes PINs, so recovery is a
// "Reset PIN" action instead — a real UX change, not a missing feature).
import { ref, onMounted } from 'vue'
import { api } from '../api/client'

const props = defineProps({
  division: { type: String, required: true }, // 'retail' | 'warehouse'
  outlet: { type: String, required: true },
  managerLabel: { type: String, required: true },
})

const staff = ref([])
const loading = ref(true)

const addName = ref('')
const addPin = ref('')
const addError = ref('')
const adding = ref(false)

const resettingName = ref('') // which row's reset form is open
const resetPin = ref('')
const resetError = ref('')
const resetting = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await api.getStaffRosterFull(props.division, props.outlet)
    staff.value = data.staff || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}
onMounted(load)

async function addStaff() {
  addError.value = ''
  const name = addName.value.trim().toUpperCase()
  if (!name || !/^\d{4}$/.test(addPin.value.trim())) {
    addError.value = 'Enter a name and a 4-digit passcode.'
    return
  }
  adding.value = true
  try {
    await api.addStaff({ division: props.division, outlet: props.outlet, name, pin: addPin.value.trim(), addedBy: props.managerLabel })
    addName.value = ''
    addPin.value = ''
    await load()
  } catch (err) {
    addError.value = err.message || 'Could not add staff.'
  } finally {
    adding.value = false
  }
}

function startReset(name) {
  resettingName.value = name
  resetPin.value = ''
  resetError.value = ''
}

async function submitReset() {
  resetError.value = ''
  if (!/^\d{4}$/.test(resetPin.value.trim())) {
    resetError.value = 'Enter a new 4-digit passcode.'
    return
  }
  resetting.value = true
  try {
    await api.resetStaffPin({ division: props.division, outlet: props.outlet, name: resettingName.value, pin: resetPin.value.trim() })
    resettingName.value = ''
  } catch (err) {
    resetError.value = err.message || 'Could not reset the passcode.'
  } finally {
    resetting.value = false
  }
}

async function removeStaff(name) {
  if (!confirm(`Remove ${name} from the roster? They won't be able to log in until re-added.`)) return
  try {
    await api.removeStaff({ division: props.division, outlet: props.outlet, name })
    await load()
  } catch (e) { /* best-effort */ }
}
</script>

<template>
  <div class="bg-white rounded-xl2 shadow-sm">
    <div v-if="loading" class="p-5 text-slate text-sm">Loading...</div>
    <div v-else>
      <div v-if="staff.length === 0" class="p-5 text-slate text-sm">No staff added for this {{ division === 'warehouse' ? 'location' : 'outlet' }} yet.</div>
      <div v-else class="divide-y divide-seafoam">
        <div v-for="s in staff" :key="s.Name" class="px-5 py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ s.Name }}</p>
              <p class="text-xs text-slate">Added {{ new Date(s.Timestamp).toLocaleDateString() }}{{ s.AddedBy ? ' by ' + s.AddedBy : '' }}</p>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <button @click="startReset(s.Name)" class="text-aqua text-xs font-medium underline">Reset PIN</button>
              <button @click="removeStaff(s.Name)" class="text-coral text-xs font-medium underline">Remove</button>
            </div>
          </div>
          <div v-if="resettingName === s.Name" class="mt-3 flex items-center gap-2">
            <input v-model="resetPin" type="password" inputmode="numeric" maxlength="4" placeholder="New 4-digit PIN"
              class="flex-1 min-w-0 border border-slate/30 rounded-lg py-1.5 px-3 text-sm" />
            <button @click="submitReset" :disabled="resetting" class="bg-aqua text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60">
              {{ resetting ? '...' : 'Save' }}
            </button>
            <button @click="resettingName = ''" class="text-slate text-xs">Cancel</button>
          </div>
          <p v-if="resettingName === s.Name && resetError" class="text-coral text-xs mt-1">{{ resetError }}</p>
        </div>
      </div>
    </div>

    <form @submit.prevent="addStaff" class="border-t border-seafoam p-5 flex items-center gap-2">
      <input v-model="addName" type="text" placeholder="Name" class="flex-1 min-w-0 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="addPin" type="password" inputmode="numeric" maxlength="4" placeholder="4-digit PIN" class="w-32 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="adding" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shrink-0">
        {{ adding ? 'Adding...' : 'Add' }}
      </button>
    </form>
    <p v-if="addError" class="text-coral text-xs px-5 pb-4 -mt-3">{{ addError }}</p>
  </div>
</template>
