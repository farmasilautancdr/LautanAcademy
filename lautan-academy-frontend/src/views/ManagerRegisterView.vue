<script setup>
// Mirrors ManagerLoginView.vue's division toggle and outlet list. Used for
// first-time signup, a forgotten password, or outlet handover — all three
// are the same action here: prove you know today's master PIN, set a new
// password. See docs/superpowers/specs/2026-08-06-manager-auth-design.md.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'
import PasswordField from '../components/PasswordField.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'

const { t } = useI18n()

const OUTLET_LIST = ["AJ", "B6", "BB", "BJR", "BP", "CDR", "CK", "DG", "DGD", "GB", "GBD", "GM", "HL", "HQ", "HQCT", "JL", "JLD", "JTH", "KB", "KBKK", "KBKS", "KBTJ", "KKR", "KL", "KMD", "KMN", "KMSK", "KS", "MC", "MCD", "MLR", "MR", "PC", "PDM", "PK", "PM", "PP", "PPK", "PSPD", "PT", "RJ", "SLS", "SMR", "ST", "TM", "TMD", "TMT", "TPOH", "TPT", "WM"];
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic'];

const division = ref('retail')
const outlet = ref('')
const masterPin = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS : OUTLET_LIST)

function switchDivision(d) {
  division.value = d
  outlet.value = ''
}

async function handleRegister() {
  error.value = ''
  if (!outlet.value) {
    error.value = division.value === 'warehouse' ? t('managerRegister.errorSelectLocation') : t('managerRegister.errorSelectOutlet')
    return
  }
  if (!masterPin.value.trim()) {
    error.value = t('managerRegister.errorMasterPin')
    return
  }
  if (newPassword.value.length < 6) {
    error.value = t('managerRegister.errorPasswordLength')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = t('managerRegister.errorPasswordMismatch')
    return
  }
  loading.value = true
  const role = division.value === 'warehouse' ? 'warehouse_manager' : 'outlet_manager'
  try {
    await auth.registerManager(role, outlet.value, masterPin.value.trim(), newPassword.value)
    router.push(role === 'warehouse_manager' ? '/warehouse-manager' : '/manager')
  } catch (err) {
    error.value = err.message || t('managerRegister.errorRegisterFailed')
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
        <p class="text-slate text-sm mt-3 text-center">{{ t('managerRegister.subtitle') }}</p>
      </div>

      <form @submit.prevent="handleRegister" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1.5">{{ t('managerRegister.division') }}</label>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="t('managerRegister.division')">
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'retail'"
              @click="switchDivision('retail')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'retail' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >{{ t('managerRegister.retail') }}</button>
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'warehouse'"
              @click="switchDivision('warehouse')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'warehouse' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >{{ t('managerRegister.warehouse') }}</button>
          </div>
        </div>

        <div>
          <label for="outlet" class="block text-sm font-medium text-ink mb-1">{{ division === 'warehouse' ? t('managerRegister.locationLabel') : t('managerRegister.outletLabel') }}</label>
          <select id="outlet" v-model="outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">{{ division === 'warehouse' ? t('managerRegister.selectLocation') : t('managerRegister.selectOutlet') }}</option>
            <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <div>
          <label for="master-pin" class="block text-sm font-medium text-ink mb-1">{{ t('managerRegister.masterPin') }}</label>
          <PasswordField
            id="master-pin"
            v-model="masterPin"
            placeholder="••••••"
            input-class="w-full text-center text-2xl tracking-[0.3em] font-display border border-slate/30 rounded-lg py-3 pl-10 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
          <p class="text-xs text-slate mt-1">{{ division === 'warehouse' ? t('managerRegister.masterPinHintLocation') : t('managerRegister.masterPinHintOutlet') }}</p>
        </div>

        <div>
          <label for="new-password" class="block text-sm font-medium text-ink mb-1">{{ t('managerRegister.newPassword') }}</label>
          <PasswordField
            id="new-password"
            v-model="newPassword"
            :placeholder="t('managerRegister.newPasswordPlaceholder')"
            input-class="w-full border border-slate/30 rounded-lg py-2.5 pl-3 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-ink mb-1">{{ t('managerRegister.confirmPassword') }}</label>
          <PasswordField
            id="confirm-password"
            v-model="confirmPassword"
            :placeholder="t('managerRegister.confirmPasswordPlaceholder')"
            input-class="w-full border border-slate/30 rounded-lg py-2.5 pl-3 pr-10 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
          />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? t('managerRegister.registering') : t('managerRegister.register') }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        {{ t('managerRegister.alreadyRegisteredPrompt') }}<router-link to="/manager-login" class="underline">{{ t('managerRegister.logInHere') }}</router-link>
      </p>
    </div>
  </div>
</template>
