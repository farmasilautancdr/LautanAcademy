<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import { useOutlets } from '../composables/useOutlets'
import DigitCode from '../components/DigitCode.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import MasterKeyButton from '../components/MasterKeyButton.vue'
import logoUrl from '../assets/logo-transparent.png'

const { t } = useI18n()

const { retailOutlets: OUTLET_LIST, warehouseLocations: WAREHOUSE_LOCATIONS } = useOutlets()

const division = ref('retail')
const outlet = ref('')
const name = ref('')
const staffNames = ref([])
const pin = ref('')
const pinBox = ref(null)
const error = ref('')
const loading = ref(false)
const router = useRouter()
const auth = useAuthStore()

const outletOptions = computed(() => division.value === 'warehouse' ? WAREHOUSE_LOCATIONS.value : OUTLET_LIST.value)

// Switching division invalidates whatever outlet/location was picked (a
// retail code isn't a valid warehouse location and vice versa).
watch(division, () => { outlet.value = '' })

// Re-fetch the name list whenever division or outlet changes — matches the
// vanilla app's populateStaffNameOptions behavior.
watch([division, outlet], async ([div, out]) => {
  name.value = ''
  staffNames.value = []
  if (!out) return
  try {
    const data = await api.getStaffNames(div, out)
    staffNames.value = data.staff || []
  } catch (e) { /* leave the list empty — user can retry by reselecting outlet */ }
})

async function handleLogin() {
  error.value = ''
  if (!outlet.value.trim() || !name.value.trim()) {
    error.value = t('loginView.errorMissingFields')
    return
  }
  if (!/^\d{4}$/.test(pin.value)) {
    error.value = t('loginView.errorBadPasscode')
    return
  }
  loading.value = true
  try {
    await auth.login(division.value, outlet.value.trim(), name.value.trim(), pin.value)
    router.push('/')
  } catch (err) {
    error.value = t('loginView.errorNotRecognized')
    pin.value = ''
    pinBox.value?.focus()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam flex flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm motion-safe:animate-[rise_0.5s_ease-out]">
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
          <p class="text-slate text-sm mt-1.5">{{ t('loginView.tagline') }}</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="bg-white rounded-xl2 p-6 shadow-sm border border-seafoam space-y-5">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-ink mb-1.5">{{ t('loginView.division') }}</label>
            <div class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="t('loginView.division')">
              <button
                type="button"
                role="radio"
                :aria-checked="division === 'retail'"
                @click="division = 'retail'"
                class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
                :class="division === 'retail' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
              >{{ t('loginView.retail') }}</button>
              <button
                type="button"
                role="radio"
                :aria-checked="division === 'warehouse'"
                @click="division = 'warehouse'"
                class="py-2.5 rounded-lg text-sm font-medium border transition-colors"
                :class="division === 'warehouse' ? 'bg-aqua text-white border-aqua' : 'border-slate/30 text-slate hover:border-aqua/50'"
              >{{ t('loginView.warehouse') }}</button>
            </div>
          </div>

          <div>
            <label for="outlet" class="block text-sm font-medium text-ink mb-1.5">{{ division === 'warehouse' ? t('loginView.locationLabel') : t('loginView.outletLabel') }}</label>
            <select id="outlet" v-model="outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
              <option value="">{{ division === 'warehouse' ? t('loginView.selectLocation') : t('loginView.selectOutlet') }}</option>
              <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
            </select>
          </div>

          <div>
            <label for="name" class="block text-sm font-medium text-ink mb-1.5">{{ t('loginView.yourName') }}</label>
            <select id="name" v-model="name" :disabled="!outlet" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua">
              <option value="">{{ outlet ? (staffNames.length ? t('loginView.selectName') : t('loginView.noStaff')) : t('loginView.selectOutletFirst') }}</option>
              <option v-for="n in staffNames" :key="n.name" :value="n.name">{{ n.name }}{{ n.idNote ? ' (' + n.idNote + ')' : '' }}</option>
            </select>
          </div>
        </div>

        <div class="border-t border-seafoam pt-5">
          <label class="block text-sm font-medium text-ink mb-2 text-center">{{ t('loginView.passcode') }}</label>
          <DigitCode ref="pinBox" v-model="pin" :length="4" masked />
        </div>

        <p v-if="error" class="text-coral text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-aqua text-white font-medium py-3 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60"
        >
          {{ loading ? t('loginView.checking') : t('loginView.logIn') }}
        </button>
      </form>

      <p class="text-center text-slate text-xs mt-6">{{ t('loginView.askManager') }}</p>
      <p class="text-center text-slate text-xs mt-2">
        {{ t('loginView.managerPrompt') }}<router-link to="/manager-login" class="underline">{{ t('loginView.logInHere') }}</router-link>
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
