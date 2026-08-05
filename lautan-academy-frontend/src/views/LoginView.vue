<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import DigitCode from '../components/DigitCode.vue'
import logoUrl from '../assets/logo-transparent.png'

// Static outlet list — same 49 codes hardcoded in the vanilla-JS app
// (index.html's `outletList`). Not fetched from the backend; there's no
// "outlets" table backing the real system, outlets are just codes.
const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];
// Warehouse division picks a location instead of a retail outlet code —
// same 4 fixed values as the vanilla app's wh-staff-location select.
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];

const division = ref('retail')
const outlet = ref('')
const name = ref('')
const staffNames = ref([])
const pin = ref('')
const pinBox = ref(null)
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS : OUTLET_LIST)

// Switching division invalidates whatever outlet/location was picked (a
// retail code isn't a valid warehouse location and vice versa).
watch(division, () => { outlet.value = '' })

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
  if (!/^\d{4}$/.test(pin.value)) {
    error.value = 'Enter your 4-digit passcode.'
    return
  }
  loading.value = true
  try {
    await auth.login(division.value, outlet.value.trim(), name.value.trim(), pin.value)
    router.push('/')
  } catch (err) {
    error.value = 'That name/passcode combination was not recognized. Check with your outlet manager.'
    pin.value = ''
    pinBox.value?.focus()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm motion-safe:animate-[rise_0.5s_ease-out]">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3">
          <img :src="logoUrl" alt="Lautan Academy" class="w-20 h-20 shrink-0" />
          <div class="text-left h-20 flex flex-col justify-center">
            <h1 class="font-display text-3xl font-bold text-ink tracking-tight leading-none">LAUTAN</h1>
            <p class="font-display text-xs font-medium text-aqua tracking-[0.35em] leading-none mt-1.5">ACADEMY</p>
          </div>
        </div>
        <p class="text-slate text-sm mt-3 text-center">Farmasi Lautan staff training</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-5">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-ink mb-1.5">Division</label>
            <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Division">
              <button
                type="button"
                role="radio"
                :aria-checked="division === 'retail'"
                @click="division = 'retail'"
                class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
                :class="division === 'retail' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
              >Retail</button>
              <button
                type="button"
                role="radio"
                :aria-checked="division === 'warehouse'"
                @click="division = 'warehouse'"
                class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
                :class="division === 'warehouse' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
              >Warehouse</button>
            </div>
          </div>

          <div>
            <label for="outlet" class="block text-sm font-medium text-ink mb-1.5">{{ division === 'warehouse' ? 'Location' : 'Outlet' }}</label>
            <select id="outlet" v-model="outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
              <option value="">{{ division === 'warehouse' ? 'Select location...' : 'Select outlet...' }}</option>
              <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
            </select>
          </div>

          <div>
            <label for="name" class="block text-sm font-medium text-ink mb-1.5">Your name</label>
            <select id="name" v-model="name" :disabled="!outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
              <option value="">{{ outlet ? (staffNames.length ? 'Select your name...' : 'No staff added for this outlet yet') : 'Select outlet first...' }}</option>
              <option v-for="n in staffNames" :key="n" :value="n">{{ n }}</option>
            </select>
          </div>
        </div>

        <div class="border-t border-seafoam pt-5">
          <label class="block text-sm font-medium text-ink mb-2 text-center">Passcode</label>
          <DigitCode ref="pinBox" v-model="pin" :length="4" masked />
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

      <p class="text-center text-slate text-xs mt-6">Ask your outlet manager if you don't have a passcode.</p>
      <p class="text-center text-slate text-xs mt-2">
        Manager? <router-link to="/manager-login" class="underline">Log in here</router-link>
      </p>
    </div>
  </div>
</template>

<style scoped>
@keyframes rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
