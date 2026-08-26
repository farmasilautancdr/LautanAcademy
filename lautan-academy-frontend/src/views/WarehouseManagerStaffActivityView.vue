<script setup>
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { useOutletStaffActivity } from '../composables/useStaffActivity'

const auth = useAuthStore()
const { t } = useI18n()
const outlet = auth.manager?.outlet
const { loading, staff, activeCount, totalCount, ACTIVE_WINDOW_DAYS } = useOutletStaffActivity('warehouse', outlet)
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleWarehouseManager') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('staffActivityView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p class="text-slate text-sm mb-6">{{ t('staffActivityView.summary', { active: activeCount, total: totalCount, days: ACTIVE_WINDOW_DAYS }) }}</p>

      <div v-if="loading" class="text-slate text-sm">{{ t('staffActivityView.loading') }}</div>
      <div v-else-if="!staff.length" class="bg-white rounded-xl2 px-5 py-4">
        <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('staffActivityView.noStaff') }}</p>
      </div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <div v-for="s in staff" :key="s.name" class="px-5 py-3 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ s.name }}</p>
            <p class="text-xs text-slate">{{ s.lastAttempt ? t('staffActivityView.lastActive', { date: new Date(s.lastAttempt).toLocaleDateString() }) : t('staffActivityView.noActivityYet') }}</p>
          </div>
          <span class="text-xs font-display font-semibold shrink-0 px-2 py-1 rounded-full" :class="s.active ? 'bg-aqualight text-deepsea' : 'bg-coral/10 text-coral'">
            {{ s.active ? t('staffActivityView.active') : t('staffActivityView.inactive') }}
          </span>
        </div>
      </div>
    </main>
  </div>
</template>
