<script setup>
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { useAreaStaffActivity } from '../composables/useStaffActivity'

const auth = useAuthStore()
const { t } = useI18n()
const { loading, outletActivity, activeOutletCount, totalOutletCount, ACTIVE_WINDOW_DAYS } = useAreaStaffActivity(auth.manager?.outlets || [])
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleAreaManager') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('areaStaffActivityView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p class="text-slate text-sm mb-6">{{ t('areaStaffActivityView.summary', { active: activeOutletCount, total: totalOutletCount, days: ACTIVE_WINDOW_DAYS }) }}</p>

      <div v-if="loading" class="text-slate text-sm">{{ t('areaStaffActivityView.loading') }}</div>
      <div v-else-if="!outletActivity.length" class="bg-white rounded-xl2 px-5 py-4">
        <p class="text-slate text-xs font-semibold uppercase tracking-wide">{{ t('areaStaffActivityView.noOutlets') }}</p>
      </div>
      <div v-else class="space-y-3">
        <div v-for="o in outletActivity" :key="o.outlet" class="bg-white rounded-xl2 px-5 py-4">
          <div class="flex items-center justify-between gap-3 mb-1">
            <p class="text-sm font-display font-semibold text-ink">{{ o.outlet }}</p>
            <span class="text-xs font-display font-semibold shrink-0 px-2 py-1 rounded-full" :class="o.activeCount > 0 ? 'bg-aqualight text-deepsea' : 'bg-coral/10 text-coral'">
              {{ o.activeCount > 0 ? t('areaStaffActivityView.activeStaffCount', o.activeCount) : t('areaStaffActivityView.needsAttention') }}
            </span>
          </div>
          <p v-if="o.activeCount > 0" class="text-xs text-slate truncate">{{ o.activeStaff.join(', ') }}</p>
          <p v-else class="text-xs text-slate">{{ t('areaStaffActivityView.noActivity', { days: ACTIVE_WINDOW_DAYS }) }}</p>
        </div>
      </div>
    </main>
  </div>
</template>
