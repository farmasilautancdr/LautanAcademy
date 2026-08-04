<script setup>
// Supervisor is the one unscoped role — no outlet/location picker, just PIN.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'

const pin = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

async function handleLogin() {
  error.value = ''
  if (!pin.value.trim()) {
    error.value = 'Enter the Supervisor PIN.'
    return
  }
  loading.value = true
  try {
    await auth.loginManager('supervisor', '', pin.value.trim())
    router.push('/supervisor')
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
        <p class="text-aqualight mt-2 text-sm">Supervisor</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-xl space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">Supervisor PIN</label>
          <input
            v-model="pin"
            type="password"
            placeholder="••••••"
            autofocus
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
        Outlet/Warehouse Manager?
        <router-link to="/manager-login" class="underline">Log in here</router-link>
      </p>
      <p class="text-center text-aqualight/70 text-xs mt-2">
        Area Manager? <router-link to="/area-manager-login" class="underline">Log in here</router-link>
      </p>
    </div>
  </div>
</template>
