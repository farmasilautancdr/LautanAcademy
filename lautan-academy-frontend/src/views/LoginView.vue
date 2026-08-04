<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

// Static outlet list — same 49 codes hardcoded in the vanilla-JS app
// (index.html's `outletList`). Not fetched from the backend; there's no
// "outlets" table backing the real system, outlets are just codes.
const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];

const division = ref('retail')
const outlet = ref('')
const name = ref('')
const pin = ref('')
const staffNames = ref([])
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

// Re-fetch the name list whenever division or outlet changes — matches the
// vanilla app's populateStaffNameOptions behavior.
watch([division, outlet], async ([div, out]) => {
  name.value = ''
  staffNames.value = []
  if (!out) return
  try {
    const data = await api.getStaffNames(div, out)
    staffNames.value = data.staff || []
  } catch (e) { /* leave the list empty — user can retry by reselecting outlet */ }
})

async function handleLogin() {
  error.value = ''
  if (!outlet.value.trim() || !name.value.trim()) {
    error.value = 'Enter your outlet and name.'
    return
  }
  if (!/^\d{4}$/.test(pin.value.trim())) {
    error.value = 'Enter your 4-digit passcode.'
    return
  }
  loading.value = true
  try {
    await auth.login(division.value, outlet.value.trim(), name.value.trim(), pin.value.trim())
    router.push('/')
  } catch (err) {
    error.value = 'That name/passcode combination was not recognized. Check with your outlet manager.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-deepsea flex items-center justify-center px-6">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <h1 class="font-display text-3xl font-bold text-white tracking-tight">Lautan Academy</h1>
        <p class="text-aqualight mt-2 text-sm">Farmasi Lautan staff training</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-xl space-y-4">
        <div>
          <label for="division" class="block text-sm font-medium text-ink mb-1">Division</label>
          <select id="division" v-model="division" class="w-full border border-slate/30 rounded-lg py-2 px-3">
            <option value="retail">Retail</option>
            <option value="warehouse">Warehouse</option>
          </select>
        </div>

        <div>
          <label for="outlet" class="block text-sm font-medium text-ink mb-1">Outlet</label>
          <select id="outlet" v-model="outlet" class="w-full border border-slate/30 rounded-lg py-2 px-3">
            <option value="">Select outlet...</option>
            <option v-for="o in OUTLET_LIST" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <div>
          <label for="name" class="block text-sm font-medium text-ink mb-1">Your name</label>
          <select id="name" v-model="name" :disabled="!outlet" class="w-full border border-slate/30 rounded-lg py-2 px-3 disabled:opacity-50">
            <option value="">{{ outlet ? (staffNames.length ? 'Select your name...' : 'No staff added for this outlet yet') : 'Select outlet first...' }}</option>
            <option v-for="n in staffNames" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>

        <div>
          <label for="pin" class="block text-sm font-medium text-ink mb-1">Passcode</label>
          <input
            id="pin"
            v-model="pin"
            type="password"
            inputmode="numeric"
            maxlength="4"
            placeholder="••••"
            class="w-full text-center text-2xl tracking-[0.5em] font-display border border-slate/30 rounded-lg py-3 focus:outline-none focus:ring-2 focus:ring-aqua"
          />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? 'Checking...' : 'Log in' }}
        </button>
      </form>

      <p class="text-center text-aqualight/70 text-xs mt-6">Ask your outlet manager if you don't have a passcode.</p>
      <p class="text-center text-aqualight/70 text-xs mt-2">
        Manager? <router-link to="/manager-login" class="underline">Log in here</router-link>
      </p>
    </div>
  </div>
</template>
