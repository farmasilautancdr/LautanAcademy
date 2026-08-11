<script setup>
// Master-only: one-click full-DB export (Subsystem F). Mirrors
// MasterMaintenance.vue's back-button + status-message shape. See
// docs/superpowers/specs/2026-08-11-master-subsystem-f-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const exporting = ref(false)
const status = ref('')
const statusOk = ref(false)

async function exportBackup() {
  exporting.value = true
  status.value = ''
  try {
    const { blob, filename } = await api.masterBackupExport(masterAuth.token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    status.value = t('masterPanel.backupExport.success')
    statusOk.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.backupExport.errorFailed')
    statusOk.value = false
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="px-5 py-4 space-y-4">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.backupExport.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.backupExport.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.backupExport.intro') }}</p>
    </div>

    <button
      type="button"
      :disabled="exporting"
      @click="exportBackup"
      class="w-full bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ exporting ? t('masterPanel.backupExport.exporting') : t('masterPanel.backupExport.exportButton') }}
    </button>

    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
  </div>
</template>
