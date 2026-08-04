<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'

const LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']

const location = ref('')
const pin = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

async function handleLogin() {
  error.value = ''
  if (!location.value) {
    error.value = 'Select your location.'
    return
  }
  if (!pin.value.trim()) {
    error.value = 'Enter the manager PIN.'
    return
  }
  loading.value = true
  try {
    await auth.loginManager('warehouse_manager', location.value, pin.value.trim())
    router.push('/warehouse-manager')
  } catch (err) {
    error.value = err.message || 'That PIN doesn\'t look right.'
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
        <p class="text-aqualight mt-2 text-sm">Warehouse Manager</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-xl space-y-4">
        <div>
          <label for="location" class="block text-sm font-medium text-ink mb-1">Location</label>
          <select id="location" v-model="location" class="w-full border border-slate/30 rounded-lg py-2 px-3">
            <option value="">Select location...</option>
            <option v-for="l in LOCATIONS" :key="l" :value="l">{{ l }}</option>
          </select>
        </div>

        <div>
          <label for="pin" class="block text-sm font-medium text-ink mb-1">Manager PIN</label>
          <input
            id="pin"
            v-model="pin"
            type="password"
            placeholder="••••••"
            class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 focus:outline-none focus:ring-2 focus:ring-aqua"
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
        Outlet Manager? <router-link to="/manager-login" class="underline">Log in here</router-link>
      </p>
    </div>
  </div>
</template>
