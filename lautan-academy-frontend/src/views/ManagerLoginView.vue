<script setup>
// Retail/Warehouse division picks between Outlet Manager and Warehouse
// Manager — same pattern as staff login. These are genuinely different
// backend roles (outlet_manager vs warehouse_manager), not variants of one
// role, so the toggle drives both which option list shows and which role
// gets sent to /auth/manager-login.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'

const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];

const division = ref('retail')
const outlet = ref('')
const pin = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS : OUTLET_LIST)

function switchDivision(d) {
  division.value = d
  outlet.value = ''
}

async function handleLogin() {
  error.value = ''
  if (!outlet.value) {
    error.value = division.value === 'warehouse' ? 'Select your location.' : 'Select your outlet.'
    return
  }
  if (!pin.value.trim()) {
    error.value = 'Enter the manager PIN.'
    return
  }
  loading.value = true
  const role = division.value === 'warehouse' ? 'warehouse_manager' : 'outlet_manager'
  try {
    await auth.loginManager(role, outlet.value, pin.value.trim())
    router.push(role === 'warehouse_manager' ? '/warehouse-manager' : '/manager')
  } catch (err) {
    error.value = err.message || 'That PIN doesn\'t look right.'
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
        <p class="text-slate text-sm mt-3 text-center">Outlet / Warehouse Manager</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1.5">Division</label>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Division">
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'retail'"
              @click="switchDivision('retail')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'retail' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >Retail</button>
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'warehouse'"
              @click="switchDivision('warehouse')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'warehouse' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >Warehouse</button>
          </div>
        </div>

        <div>
          <label for="outlet" class="block text-sm font-medium text-ink mb-1">{{ division === 'warehouse' ? 'Location' : 'Outlet' }}</label>
          <select id="outlet" v-model="outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">{{ division === 'warehouse' ? 'Select location...' : 'Select outlet...' }}</option>
            <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <div>
          <label for="pin" class="block text-sm font-medium text-ink mb-1">Manager PIN</label>
          <input
            id="pin"
            v-model="pin"
            type="password"
            placeholder="••••••"
            class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
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

      <p class="text-center text-slate text-xs mt-6">
        Staff? <router-link to="/login" class="underline">Log in here</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        Area Manager? <router-link to="/area-manager-login" class="underline">Log in here</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        Supervisor? <router-link to="/supervisor-login" class="underline">Log in here</router-link>
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
