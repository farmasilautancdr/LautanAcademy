<script setup>
// Area Manager picks their region (fixed roster below, matches the vanilla
// app's managerData exactly), then the shared category PIN. Scope is the
// whole region now, not one outlet within it — the backend independently
// validates the area id and resolves it to that region's outlet list
// (config/areas.js), so this list is for the picker only, not trusted for
// scoping.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'
import { AREAS, outletsForArea } from '../config/areas'
import PasswordField from '../components/PasswordField.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'

const { t } = useI18n()

const areaId = ref('')
const pin = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

async function handleLogin() {
  error.value = ''
  if (!areaId.value) {
    error.value = t('areaManagerLogin.errorSelectArea')
    return
  }
  if (!pin.value.trim()) {
    error.value = t('areaManagerLogin.errorEnterPin')
    return
  }
  loading.value = true
  try {
    await auth.loginManager('area_manager', areaId.value, pin.value.trim(), areaId.value, outletsForArea(areaId.value))
    router.push('/area-manager')
  } catch (err) {
    error.value = err.message || t('areaManagerLogin.errorBadPin')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm motion-safe:animate-[rise_0.5s_ease-out]">
      <div class="flex justify-end mb-2">
        <LanguageSwitcher />
      </div>
      <div class="mb-8 flex items-center justify-center gap-3 w-full">
        <img :src="logoUrl" alt="Lautan Academy" class="w-24 h-24 shrink-0" />
        <div class="flex flex-col items-start">
          <h1 class="flex items-baseline gap-1.5">
            <span class="font-script text-4xl text-ink leading-none">Lautan</span>
            <span class="font-display text-xl font-bold text-aqua tracking-tight leading-none">Academy</span>
          </h1>
          <p class="text-slate text-sm mt-1.5">{{ t('areaManagerLogin.subtitle') }}</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('areaManagerLogin.area') }}</label>
          <select v-model="areaId" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">{{ t('areaManagerLogin.selectArea') }}</option>
            <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('areaManagerLogin.managerPin') }}</label>
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
          {{ loading ? t('areaManagerLogin.checking') : t('areaManagerLogin.logIn') }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        {{ t('areaManagerLogin.staffPrompt') }}<router-link to="/login" class="underline">{{ t('areaManagerLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('areaManagerLogin.outletManagerPrompt') }}
        <router-link to="/manager-login" class="underline">{{ t('areaManagerLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('areaManagerLogin.supervisorPrompt') }}<router-link to="/supervisor-login" class="underline">{{ t('areaManagerLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('areaManagerLogin.firstTimePrompt') }}<router-link to="/area-manager-register" class="underline">{{ t('areaManagerLogin.registerRegion') }}</router-link>
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
