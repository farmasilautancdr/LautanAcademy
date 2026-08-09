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
import logoUrl from '../assets/logo-transparent.png'
import { AREAS, outletsForArea } from '../config/areas'
import PasswordField from '../components/PasswordField.vue'

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
        <p class="text-slate text-sm mt-3 text-center">Area Manager</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">Area</label>
          <select v-model="areaId" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">Select your area...</option>
            <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink mb-1">Manager PIN</label>
          <PasswordField
            v-model="pin"
            placeholder="••••••"
            input-class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 pl-10 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
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
        Outlet/Warehouse Manager?
        <router-link to="/manager-login" class="underline">Log in here</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        Supervisor? <router-link to="/supervisor-login" class="underline">Log in here</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        First time? <router-link to="/area-manager-register" class="underline">Register your region</router-link>
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
