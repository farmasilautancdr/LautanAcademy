<script setup>
// Master-only: search + bulk hard-delete across 4 test-data entity types.
// Mirrors MasterPinReset.vue's back/close pattern. See
// docs/superpowers/specs/2026-08-11-master-subsystem-c-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PurgeStaffPanel from './PurgeStaffPanel.vue'
import PurgeQuizAttemptsPanel from './PurgeQuizAttemptsPanel.vue'
import PurgeManagerAccountsPanel from './PurgeManagerAccountsPanel.vue'
import PurgeReportsContentPanel from './PurgeReportsContentPanel.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()

const SUB_TABS = ['staff', 'quizAttempts', 'managerAccounts', 'reportsContent']
const activeSubTab = ref('staff')
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.dataPurge.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.dataPurge.title') }}</h3>
    </div>

    <div class="flex flex-wrap gap-2 text-sm border-b border-seafoam pb-3">
      <button
        v-for="tabKey in SUB_TABS"
        :key="tabKey"
        type="button"
        @click="activeSubTab = tabKey"
        class="px-3 py-1.5 rounded-full"
        :class="activeSubTab === tabKey ? 'bg-aqua text-white' : 'bg-seafoam text-ink'"
      >
        {{ t(`masterPanel.dataPurge.subTab${tabKey.charAt(0).toUpperCase()}${tabKey.slice(1)}`) }}
      </button>
    </div>

    <PurgeStaffPanel v-if="activeSubTab === 'staff'" />
    <PurgeQuizAttemptsPanel v-else-if="activeSubTab === 'quizAttempts'" />
    <PurgeManagerAccountsPanel v-else-if="activeSubTab === 'managerAccounts'" />
    <PurgeReportsContentPanel v-else-if="activeSubTab === 'reportsContent'" />
  </div>
</template>
