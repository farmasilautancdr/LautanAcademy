<script setup>
import { useI18n } from 'vue-i18n'
import { useMaintenanceStore } from '../store/maintenance'

const { t } = useI18n()
const maintenance = useMaintenanceStore()

async function retry() {
  await maintenance.check()
  if (!maintenance.active) {
    window.location.reload()
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-ink/90 px-4">
    <div class="w-full max-w-sm bg-white rounded-xl2 shadow-lg p-6 space-y-4 text-center">
      <h2 class="font-display font-semibold text-ink text-lg">{{ t('maintenanceOverlay.title') }}</h2>
      <p class="text-slate text-sm">{{ t('maintenanceOverlay.body') }}</p>
      <p v-if="maintenance.message" class="text-ink text-sm font-medium border border-seafoam rounded-lg p-3">
        {{ maintenance.message }}
      </p>
      <button
        type="button"
        @click="retry"
        class="w-full bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg"
      >
        {{ t('maintenanceOverlay.tryAgain') }}
      </button>
    </div>
  </div>
</template>
