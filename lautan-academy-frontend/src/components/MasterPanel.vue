<script setup>
import { useI18n } from 'vue-i18n'
import { useMasterAuthStore } from '../store/masterAuth'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Subsystems B-H (see docs/superpowers/specs/2026-08-10-master-admin-
// subsystem-a-design.md) each fill one of these in — this round they're
// all disabled placeholders.
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']

function handleLogout() {
  masterAuth.logout()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex justify-end bg-ink/40" @click.self="emit('close')">
      <div class="w-full max-w-sm h-full bg-white shadow-lg flex flex-col">
        <div class="px-5 py-4 border-b border-seafoam flex items-center justify-between">
          <h2 class="font-display font-semibold text-ink text-lg">{{ t('masterPanel.panelTitle') }}</h2>
          <button type="button" @click="emit('close')" class="text-slate hover:text-ink text-xl leading-none" :aria-label="t('masterPanel.close')">&times;</button>
        </div>
        <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <div v-for="tabKey in TABS" :key="tabKey" class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-slate/50 cursor-not-allowed">
            <span>{{ t(`masterPanel.tab.${tabKey}`) }}</span>
            <span class="text-[10px] uppercase tracking-wide">{{ t('masterPanel.comingSoon') }}</span>
          </div>
        </nav>
        <div class="px-4 py-4 border-t border-seafoam">
          <button type="button" @click="handleLogout" class="w-full py-2.5 rounded-lg text-sm font-medium border border-slate/30 text-slate hover:border-coral hover:text-coral transition-colors">{{ t('masterPanel.logOut') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
