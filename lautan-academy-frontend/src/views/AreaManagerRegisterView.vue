<script setup>
// Mirrors AreaManagerLoginView.vue's area picker. See ManagerRegisterView.vue
// for the outlet/warehouse counterpart and the shared design rationale.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'
import { AREAS, outletsForArea } from '../config/areas'
import PasswordField from '../components/PasswordField.vue'

const areaId = ref('')
const masterPin = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

async function handleRegister() {
  error.value = ''
  if (!areaId.value) {
    error.value = 'Select your area.'
    return
  }
  if (!masterPin.value.trim()) {
    error.value = "Enter today's master PIN."
    return
  }
  if (newPassword.value.length < 6) {
    error.value = 'New password must be at least 6 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    await auth.registerManager('area_manager', areaId.value, masterPin.value.trim(), newPassword.value, areaId.value, outletsForArea(areaId.value))
    router.push('/area-manager')
  } catch (err) {
    error.value = err.message || 'Could not register. Check the master PIN.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3">
          <img :src="logoUrl" alt="Lautan Academy" class="w-20 h-20 shrink-0" />
          <div class="text-left h-20 flex flex-col justify-center">
            <h1 class="font-display text-3xl font-bold text-ink tracking-tight leading-none">LAUTAN</h1>
            <p class="font-display text-xs font-medium text-aqua tracking-[0.35em] leading-none mt-1.5">ACADEMY</p>
          </div>
        </div>
        <p class="text-slate text-sm mt-3 text-center">Register — Area Manager</p>
      </div>

      <form @submit.prevent="handleRegister" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">Area</label>
          <select v-model="areaId" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">Select your area...</option>
            <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
          </select>
        </div>

        <div>
          <label for="master-pin" class="block text-sm font-medium text-ink mb-1">Master PIN</label>
          <PasswordField
            id="master-pin"
            v-model="masterPin"
            placeholder="••••••"
            input-class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 pl-10 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
          <p class="text-xs text-slate mt-1">Get this from Supervisor/HQ — it proves you're the legitimate manager for this region.</p>
        </div>

        <div>
          <label for="new-password" class="block text-sm font-medium text-ink mb-1">New Password</label>
          <PasswordField
            id="new-password"
            v-model="newPassword"
            placeholder="At least 6 characters"
            input-class="w-full border border-slate/30 rounded-lg py-2.5 pl-3 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-ink mb-1">Confirm Password</label>
          <PasswordField
            id="confirm-password"
            v-model="confirmPassword"
            placeholder="Re-enter password"
            input-class="w-full border border-slate/30 rounded-lg py-2.5 pl-3 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? 'Registering...' : 'Register' }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        Already registered? <router-link to="/area-manager-login" class="underline">Log in here</router-link>
      </p>
    </div>
  </div>
</template>
