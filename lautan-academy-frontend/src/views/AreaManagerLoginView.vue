<script setup>
// Area Manager picks their region (fixed roster below, matches the vanilla
// app's managerData exactly), then the shared category PIN. Scope is the
// whole region now, not one outlet within it — the backend independently
// validates the area id and resolves it to that region's outlet list
// (config/areas.js), so this list is for the picker only, not trusted for
// scoping.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'

const AREAS = [
  { id: "R1 - AMIRUL", outlets: ["DG", "DGD", "KMD", "KMN", "KMSK", "MR"] },
  { id: "R2 - HAZWANI", outlets: ["AJ", "BJR", "BP", "HQCT", "KB", "WM", "PDM"] },
  { id: "R3 - HARIS", outlets: ["B6", "BB", "CDR", "HL", "HQ", "KL", "PK"] },
  { id: "R4 - RAIHAN", outlets: ["GB", "GBD", "JTH", "RJ", "ST", "TPOH"] },
  { id: "R5 - ADNIN", outlets: ["JL", "JLD", "PP", "PSPD", "SMR"] },
  { id: "R6 - NADHIRAH", outlets: ["KS", "MC", "MLR", "TM", "TMD", "TMT", "MCD"] },
  { id: "R7 - HASANUL", outlets: ["KBKK", "KBKS", "KBTJ", "PC", "PT"] },
  { id: "R8 - HAFSHAM", outlets: ["PM", "SLS", "TPT", "KKR", "PPK"] },
  { id: "R9 - IFFAH / RAIHAN", outlets: ["GM", "CK"] },
]

function outletsForArea(id) { return AREAS.find(a => a.id === id)?.outlets || [] }

const areaId = ref('')
const pin = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

async function handleLogin() {
  error.value = ''
  if (!areaId.value) {
    error.value = 'Select your area.'
    return
  }
  if (!pin.value.trim()) {
    error.value = 'Enter the manager PIN.'
    return
  }
  loading.value = true
  try {
    await auth.loginManager('area_manager', areaId.value, pin.value.trim(), areaId.value, outletsForArea(areaId.value))
    router.push('/area-manager')
  } catch (err) {
    error.value = err.message || 'That PIN doesn\'t look right.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-deepsea flex flex-col items-center justify-center px-6 py-10 relative overflow-hidden">
    <div class="pointer-events-none absolute inset-0" style="background: radial-gradient(ellipse at 50% -10%, rgba(23,163,152,0.18), transparent 60%)" />

    <div class="w-full max-w-sm relative motion-safe:animate-[rise_0.5s_ease-out]">
      <div class="text-center mb-8 relative z-10">
        <h1 class="font-display text-4xl font-bold text-white tracking-tight leading-none">LAUTAN</h1>
        <p class="font-display text-xs font-medium text-aqua tracking-[0.35em] mt-1.5">ACADEMY</p>
        <p class="text-aqualight/80 mt-3 text-sm">Area Manager</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-xl relative z-10 space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">Area</label>
          <select v-model="areaId" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">Select your area...</option>
            <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink mb-1">Manager PIN</label>
          <input
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

      <p class="text-center text-aqualight/70 text-xs mt-6">
        Staff? <router-link to="/login" class="underline">Log in here</router-link>
      </p>
      <p class="text-center text-aqualight/70 text-xs mt-2">
        Outlet/Warehouse Manager?
        <router-link to="/manager-login" class="underline">Log in here</router-link>
      </p>
      <p class="text-center text-aqualight/70 text-xs mt-2">
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
