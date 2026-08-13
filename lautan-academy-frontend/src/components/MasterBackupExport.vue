<script setup>
// Master-only: one-click full-DB export (Subsystem F), plus Annual Data
// Reset — archive-then-clear quiz-attempt history + audit log older than
// the current calendar year. Reset is hard-gated behind a successful
// export in the same visit (backedUp flag, resets on every fresh mount —
// never persisted). See
// docs/superpowers/specs/2026-08-11-master-subsystem-f-design.md and
// docs/superpowers/specs/2026-08-14-annual-data-reset-design.md.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const exporting = ref(false)
const status = ref('')
const statusOk = ref(false)
const backedUp = ref(false)

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
    backedUp.value = true
  } catch (err) {
    status.value = err.message || t('masterPanel.backupExport.errorFailed')
    statusOk.value = false
  } finally {
    exporting.value = false
  }
}

const previewCounts = ref(null)
const previewCutoff = ref(null)
const previewError = ref('')
const showResetConfirm = ref(false)
const resetting = ref(false)
const resetStatus = ref('')
const resetStatusOk = ref(false)

async function loadPreview() {
  previewError.value = ''
  try {
    const data = await api.masterAnnualResetPreview(masterAuth.token)
    previewCounts.value = data.counts
    previewCutoff.value = data.cutoff
  } catch (err) {
    previewError.value = err.message || t('masterPanel.backupExport.annualReset.errorPreviewFailed')
  }
}
onMounted(loadPreview)

function resetBreakdown() {
  if (!previewCounts.value) return []
  const c = previewCounts.value
  return [
    { label: t('masterPanel.backupExport.annualReset.breakdownResults'), count: c.results },
    { label: t('masterPanel.backupExport.annualReset.breakdownWrongAnswers'), count: c.wrongAnswers },
    { label: t('masterPanel.backupExport.annualReset.breakdownAiResults'), count: c.aiResults },
    { label: t('masterPanel.backupExport.annualReset.breakdownAiWrongAnswers'), count: c.aiWrongAnswers },
    { label: t('masterPanel.backupExport.annualReset.breakdownReports'), count: c.reports },
    { label: t('masterPanel.backupExport.annualReset.breakdownAuditLog'), count: c.auditLog },
  ]
}

async function confirmReset() {
  resetting.value = true
  resetStatus.value = ''
  try {
    const data = await api.masterAnnualReset(masterAuth.token)
    resetStatus.value = t('masterPanel.backupExport.annualReset.successReset', { count: data.deletedTotal })
    resetStatusOk.value = true
    showResetConfirm.value = false
    await loadPreview()
  } catch (err) {
    resetStatus.value = err.message || t('masterPanel.backupExport.annualReset.errorResetFailed')
    resetStatusOk.value = false
  } finally {
    resetting.value = false
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

    <div class="border-t border-seafoam pt-4 space-y-3">
      <div>
        <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.backupExport.annualReset.title') }}</h3>
        <p class="text-slate text-xs">{{ t('masterPanel.backupExport.annualReset.intro') }}</p>
      </div>

      <p v-if="previewError" class="text-coral text-xs">{{ previewError }}</p>
      <div v-else-if="previewCounts" class="border border-seafoam rounded-lg p-3 text-xs text-slate space-y-1">
        <p class="text-ink font-medium">{{ t('masterPanel.backupExport.annualReset.cutoffLabel', { date: new Date(previewCutoff).toLocaleDateString() }) }}</p>
        <div v-for="row in resetBreakdown()" :key="row.label" class="flex justify-between">
          <span>{{ row.label }}</span>
          <span class="font-medium text-ink">{{ row.count }}</span>
        </div>
      </div>

      <p v-if="!backedUp" class="text-xs text-slate">{{ t('masterPanel.backupExport.annualReset.gateHint') }}</p>
      <button
        type="button"
        :disabled="!backedUp"
        @click="showResetConfirm = true"
        class="w-full bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40"
      >
        {{ t('masterPanel.backupExport.annualReset.resetButton') }}
      </button>

      <p v-if="resetStatus" class="text-xs" :class="resetStatusOk ? 'text-aqua' : 'text-coral'">{{ resetStatus }}</p>
    </div>

    <MasterDeleteConfirmModal
      v-if="showResetConfirm"
      :title="t('masterPanel.backupExport.annualReset.confirmTitle')"
      :breakdown="resetBreakdown()"
      :loading="resetting"
      @confirm="confirmReset"
      @cancel="showResetConfirm = false"
    />
  </div>
</template>
