<script setup>
// Mirrors AreaManagerLoginView.vue's area picker. See ManagerRegisterView.vue
// for the outlet/warehouse counterpart and the shared design rationale.
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
    error.value = t('areaManagerRegister.errorSelectArea')
    return
  }
  if (!masterPin.value.trim()) {
    error.value = t('areaManagerRegister.errorMasterPin')
    return
  }
  if (newPassword.value.length < 6) {
    error.value = t('areaManagerRegister.errorPasswordLength')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = t('areaManagerRegister.errorPasswordMismatch')
    return
  }
  loading.value = true
  try {
    await auth.registerManager('area_manager', areaId.value, masterPin.value.trim(), newPassword.value, areaId.value, outletsForArea(areaId.value))
    router.push('/area-manager')
  } catch (err) {
    error.value = err.message || t('areaManagerRegister.errorRegisterFailed')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm">
      <div class="flex justify-end mb-2">
        <LanguageSwitcher />
      </div>
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3">
          <img :src="logoUrl" alt="Lautan Academy" class="w-20 h-20 shrink-0" />
          <div class="text-left h-20 flex flex-col justify-center">
            <h1 class="font-display text-3xl font-bold text-ink tracking-tight leading-none">LAUTAN</h1>
            <p class="font-display text-xs font-medium text-aqua tracking-[0.35em] leading-none mt-1.5">ACADEMY</p>
          </div>
        </div>
        <p class="text-slate text-sm mt-3 text-center">{{ t('areaManagerRegister.subtitle') }}</p>
      </div>

      <form @submit.prevent="handleRegister" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('areaManagerRegister.area') }}</label>
          <select v-model="areaId" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">{{ t('areaManagerRegister.selectArea') }}</option>
            <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }}</option>
          </select>
        </div>

        <div>
          <label for="master-pin" class="block text-sm font-medium text-ink mb-1">{{ t('areaManagerRegister.masterPin') }}</label>
          <PasswordField
            id="master-pin"
            v-model="masterPin"
            placeholder="••••••"
            input-class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 pl-10 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
          <p class="text-xs text-slate mt-1">{{ t('areaManagerRegister.masterPinHint') }}</p>
        </div>

        <div>
          <label for="new-password" class="block text-sm font-medium text-ink mb-1">{{ t('areaManagerRegister.newPassword') }}</label>
          <PasswordField
            id="new-password"
            v-model="newPassword"
            :placeholder="t('areaManagerRegister.newPasswordPlaceholder')"
            input-class="w-full border border-slate/30 rounded-lg py-2.5 pl-3 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-ink mb-1">{{ t('areaManagerRegister.confirmPassword') }}</label>
          <PasswordField
            id="confirm-password"
            v-model="confirmPassword"
            :placeholder="t('areaManagerRegister.confirmPasswordPlaceholder')"
            input-class="w-full border border-slate/30 rounded-lg py-2.5 pl-3 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? t('areaManagerRegister.registering') : t('areaManagerRegister.register') }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        {{ t('areaManagerRegister.alreadyRegisteredPrompt') }}<router-link to="/area-manager-login" class="underline">{{ t('areaManagerRegister.logInHere') }}</router-link>
      </p>
    </div>
  </div>
</template>
