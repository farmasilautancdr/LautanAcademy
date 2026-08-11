<script setup>
// Master Subsystem H. Shown for the whole time auth.impersonating is true
// (set by store/auth.js's startImpersonation). Placed in normal document
// flow above the sidebar/content row in App.vue, not fixed — matches this
// codebase's existing MaintenanceOverlay in being store-driven and
// self-contained, but simpler since this doesn't need to block anything,
// only announce it and offer a way out.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'

const { t } = useI18n()
const auth = useAuthStore()

const label = computed(() => {
  if (auth.staff) return `${auth.staff.name} (${auth.staff.outlet})`
  if (auth.manager) return `${auth.manager.role} / ${auth.manager.outlet}`
  return ''
})
</script>

<template>
  <div class="bg-coral text-white text-sm px-4 py-2 flex items-center justify-between gap-3">
    <span>{{ t('impersonationBanner.viewingAs', { label }) }}</span>
    <button type="button" @click="auth.exitImpersonation()" class="underline font-medium shrink-0">
      {{ t('impersonationBanner.exit') }}
    </button>
  </div>
</template>
