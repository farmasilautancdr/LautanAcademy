<script setup>
// Master-only: read/write the app-wide maintenance kill-switch (Subsystem
// D). Mirrors MasterPinReset.vue's back-button + status-message shape. See
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const enabled = ref(false)
const message = ref('')
const loading = ref(true)
const saving = ref(false)
const status = ref('')
const statusOk = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await api.getMaintenanceStatus()
    enabled.value = !!data.enabled
    message.value = data.message || ''
  } catch (err) {
    status.value = err.message || t('masterPanel.maintenanceMode.errorLoadFailed')
    statusOk.value = false
  } finally {
    loading.value = false
  }
}

async function save(nextEnabled) {
  saving.value = true
  status.value = ''
  try {
    const data = await api.setMaintenanceStatus(nextEnabled, message.value.trim(), masterAuth.token)
    if (data.status !== 'ok') throw new Error(data.error || t('masterPanel.maintenanceMode.errorSaveFailed'))
    enabled.value = nextEnabled
    status.value = nextEnabled ? t('masterPanel.maintenanceMode.successEnabled') : t('masterPanel.maintenanceMode.successDisabled')
    statusOk.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.maintenanceMode.errorSaveFailed')
    statusOk.value = false
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="px-5 py-4 space-y-4">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.maintenanceMode.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.maintenanceMode.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.maintenanceMode.intro') }}</p>
    </div>

    <p v-if="loading" class="text-slate text-xs">{{ t('masterPanel.maintenanceMode.loading') }}</p>
    <template v-else>
      <div class="flex items-center justify-between border border-seafoam rounded-lg px-3 py-2.5">
        <span class="text-sm text-ink">{{ enabled ? t('masterPanel.maintenanceMode.statusOn') : t('masterPanel.maintenanceMode.statusOff') }}</span>
        <span class="w-2 h-2 rounded-full" :class="enabled ? 'bg-coral' : 'bg-aqua'"></span>
      </div>

      <div>
        <label for="master-maintenance-message" class="block text-xs text-slate mb-1">{{ t('masterPanel.maintenanceMode.messageLabel') }}</label>
        <textarea
          id="master-maintenance-message"
          v-model="message"
          rows="3"
          :placeholder="t('masterPanel.maintenanceMode.messagePlaceholder')"
          class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm"
        ></textarea>
      </div>

      <button
        v-if="!enabled"
        type="button"
        :disabled="saving"
        @click="save(true)"
        class="w-full bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {{ saving ? t('masterPanel.maintenanceMode.saving') : t('masterPanel.maintenanceMode.enable') }}
      </button>
      <button
        v-else
        type="button"
        :disabled="saving"
        @click="save(false)"
        class="w-full bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {{ saving ? t('masterPanel.maintenanceMode.saving') : t('masterPanel.maintenanceMode.disable') }}
      </button>
    </template>

    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
  </div>
</template>
