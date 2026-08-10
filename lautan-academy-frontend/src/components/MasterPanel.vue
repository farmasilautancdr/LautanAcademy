<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterPinReset from './MasterPinReset.vue'
import MasterDataPurge from './MasterDataPurge.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Subsystems D-H (see docs/superpowers/specs/2026-08-10-master-admin-
// subsystem-a-design.md) each fill one of these in — pinReset and dataPurge
// are real, the rest stay disabled placeholders.
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']
const ENABLED_TABS = ['pinReset', 'dataPurge']

const activeTab = ref(null)

function handleLogout() {
  masterAuth.logout()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex justify-end bg-ink/40" @click.self="emit('close')">
      <div class="w-full h-full bg-white shadow-lg flex flex-col" :class="activeTab === 'dataPurge' ? 'max-w-3xl' : 'max-w-sm'">
        <div class="px-5 py-4 border-b border-seafoam flex items-center justify-between">
          <h2 class="font-display font-semibold text-ink text-lg">{{ t('masterPanel.panelTitle') }}</h2>
          <button type="button" @click="emit('close')" class="text-slate hover:text-ink text-xl leading-none" :aria-label="t('masterPanel.close')">&times;</button>
        </div>

        <MasterPinReset v-if="activeTab === 'pinReset'" @close="activeTab = null" />
        <MasterDataPurge v-else-if="activeTab === 'dataPurge'" @close="activeTab = null" />

        <nav v-else class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <button
            v-for="tabKey in TABS"
            :key="tabKey"
            type="button"
            :disabled="!ENABLED_TABS.includes(tabKey)"
            @click="activeTab = tabKey"
            class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left"
            :class="ENABLED_TABS.includes(tabKey) ? 'text-ink hover:bg-seafoam' : 'text-slate/50 cursor-not-allowed'"
          >
            <span>{{ t(`masterPanel.tab.${tabKey}`) }}</span>
            <span v-if="!ENABLED_TABS.includes(tabKey)" class="text-[10px] uppercase tracking-wide">{{ t('masterPanel.comingSoon') }}</span>
          </button>
        </nav>

        <div v-if="activeTab === null" class="px-4 py-4 border-t border-seafoam">
          <button type="button" @click="handleLogout" class="w-full py-2.5 rounded-lg text-sm font-medium border border-slate/30 text-slate hover:border-coral hover:text-coral transition-colors">{{ t('masterPanel.logOut') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
