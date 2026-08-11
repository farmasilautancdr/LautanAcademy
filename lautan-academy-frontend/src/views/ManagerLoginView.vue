<script setup>
// Retail/Warehouse division picks between Outlet Manager and Warehouse
// Manager — same pattern as staff login. These are genuinely different
// backend roles (outlet_manager vs warehouse_manager), not variants of one
// role, so the toggle drives both which option list shows and which role
// gets sent to /auth/manager-login.
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
    error.value = division.value === 'warehouse' ? t('managerLogin.errorSelectLocation') : t('managerLogin.errorSelectOutlet')
    return
  }
  if (!pin.value.trim()) {
    error.value = t('managerLogin.errorEnterPin')
    return
  }
  loading.value = true
  const role = division.value === 'warehouse' ? 'warehouse_manager' : 'outlet_manager'
  try {
    await auth.loginManager(role, outlet.value, pin.value.trim())
    router.push(role === 'warehouse_manager' ? '/warehouse-manager' : '/manager')
  } catch (err) {
    error.value = err.message || t('managerLogin.errorBadPin')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm motion-safe:animate-[rise_0.5s_ease-out]">
      <div class="flex justify-end items-center gap-2 mb-2">
        <LanguageSwitcher />
      </div>
      <div class="mb-8 flex items-center justify-center gap-3 w-full">
        <img :src="logoUrl" alt="Lautan Academy" class="w-24 h-24 shrink-0" />
        <div class="flex flex-col items-start">
          <h1 class="flex items-baseline gap-1.5">
            <span class="font-script text-4xl text-ink leading-none">Lautan</span>
            <span class="font-display text-xl font-bold text-aqua tracking-tight leading-none">Academy</span>
          </h1>
          <p class="text-slate text-sm mt-1.5">{{ t('managerLogin.subtitle') }}</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink mb-1.5">{{ t('managerLogin.division') }}</label>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="t('managerLogin.division')">
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'retail'"
              @click="switchDivision('retail')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'retail' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >{{ t('managerLogin.retail') }}</button>
            <button
              type="button"
              role="radio"
              :aria-checked="division === 'warehouse'"
              @click="switchDivision('warehouse')"
              class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
              :class="division === 'warehouse' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
            >{{ t('managerLogin.warehouse') }}</button>
          </div>
        </div>

        <div>
          <label for="outlet" class="block text-sm font-medium text-ink mb-1">{{ division === 'warehouse' ? t('managerLogin.locationLabel') : t('managerLogin.outletLabel') }}</label>
          <select id="outlet" v-model="outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
            <option value="">{{ division === 'warehouse' ? t('managerLogin.selectLocation') : t('managerLogin.selectOutlet') }}</option>
            <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <div>
          <label for="pin" class="block text-sm font-medium text-ink mb-1">{{ t('managerLogin.managerPin') }}</label>
          <PasswordField
            id="pin"
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
          {{ loading ? t('managerLogin.checking') : t('managerLogin.logIn') }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">
        {{ t('managerLogin.staffPrompt') }}<router-link to="/login" class="underline">{{ t('managerLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('managerLogin.areaManagerPrompt') }}<router-link to="/area-manager-login" class="underline">{{ t('managerLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('managerLogin.supervisorPrompt') }}<router-link to="/supervisor-login" class="underline">{{ t('managerLogin.logInHere') }}</router-link>
      </p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('managerLogin.firstTimePrompt') }}<router-link to="/manager-register" class="underline">{{ t('managerLogin.registerOutlet') }}</router-link>
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
