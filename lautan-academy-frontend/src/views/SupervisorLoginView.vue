<script setup>
// Supervisor is the one unscoped role — no outlet/location picker, just PIN.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'
import PasswordField from '../components/PasswordField.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import MasterKeyButton from '../components/MasterKeyButton.vue'

const { t } = useI18n()

const pin = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

async function handleLogin() {
  error.value = ''
  if (!pin.value.trim()) {
    error.value = t('supervisorLogin.errorEnterPin')
    return
  }
  loading.value = true
  try {
    await auth.loginManager('supervisor', '', pin.value.trim())
    router.push('/supervisor')
  } catch (err) {
    error.value = err.message || t('supervisorLogin.errorBadPin')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex items-center justify-center px-6">
    <div class="w-full max-w-sm">
      <div class="flex justify-end items-center gap-2 mb-2">
        <MasterKeyButton />
        <LanguageSwitcher />
      </div>
      <div class="mb-8 flex items-center justify-center gap-3 w-full">
        <img :src="logoUrl" alt="Lautan Academy" class="w-24 h-24 shrink-0" />
        <div class="flex flex-col items-start">
          <h1 class="flex items-baseline gap-1.5">
            <span class="font-script text-4xl text-ink leading-none">Lautan</span>
            <span class="font-display text-xl font-bold text-aqua tracking-tight leading-none">Academy</span>
          </h1>
          <p class="text-slate text-sm mt-1.5">{{ t('supervisorLogin.subtitle') }}</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorLogin.supervisorPin') }}</label>
          <PasswordField
            v-model="pin"
            placeholder="••••••"
            autofocus
            input-class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 pl-10 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua"
          />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? t('supervisorLogin.checking') : t('supervisorLogin.logIn') }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        {{ t('supervisorLogin.staffPrompt') }}<router-link to="/login" class="underline">{{ t('supervisorLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('supervisorLogin.outletManagerPrompt') }}
        <router-link to="/manager-login" class="underline">{{ t('supervisorLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('supervisorLogin.areaManagerPrompt') }}<router-link to="/area-manager-login" class="underline">{{ t('supervisorLogin.logInHere') }}</router-link>
      </p>
    </div>
  </div>
</template>
