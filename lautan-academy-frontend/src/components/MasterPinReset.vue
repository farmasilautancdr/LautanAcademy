<script setup>
// Master-only: reset the Supervisor role's shared PIN. Mirrors
// SupervisorManagerAccessView.vue's rotate-PIN pattern (same PasswordField
// + status-message shape) but scoped to one PIN and authenticated with the
// Master token instead of a Supervisor session. See
// docs/superpowers/specs/2026-08-11-master-subsystem-b-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import PasswordField from './PasswordField.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const newPin = ref('')
const saving = ref(false)
const status = ref('')
const statusOk = ref(false)

async function submit() {
  status.value = ''
  statusOk.value = false
  const pin = newPin.value.trim()
  if (!pin) {
    status.value = t('masterPanel.pinReset.errorEnterPin')
    return
  }
  if (pin.length < 6) {
    status.value = t('masterPanel.pinReset.errorTooShort')
    return
  }
  saving.value = true
  try {
    const res = await api.masterResetSupervisorPin(pin, masterAuth.token)
    if (res.status !== 'ok') throw new Error(res.error || t('masterPanel.pinReset.errorUpdateFailed'))
    newPin.value = ''
    status.value = t('masterPanel.pinReset.successUpdated')
    statusOk.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.pinReset.errorUpdateFailed')
    statusOk.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="px-5 py-4 space-y-4">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.pinReset.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.pinReset.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.pinReset.intro') }}</p>
    </div>
    <form @submit.prevent="submit" class="space-y-2">
      <label for="master-pin-reset-input" class="sr-only">{{ t('masterPanel.pinReset.newPinLabel') }}</label>
      <PasswordField
        id="master-pin-reset-input"
        v-model="newPin"
        :placeholder="t('masterPanel.pinReset.newPinPlaceholder')"
        input-class="w-full border border-slate/30 rounded-lg py-2 pl-3 pr-9 text-sm"
      />
      <button
        type="submit"
        :disabled="saving"
        class="w-full bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {{ saving ? t('masterPanel.pinReset.saving') : t('masterPanel.pinReset.set') }}
      </button>
    </form>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
  </div>
</template>
