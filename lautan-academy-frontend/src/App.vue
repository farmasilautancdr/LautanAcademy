<script setup>
// Sidebar shows for every logged-in state (staff or any manager role) —
// login screens stay full-width, no sidebar before there's an identity to
// show in its footer. MaintenanceOverlay reuses that same "has a real
// session" condition — it must NOT show on the login screen itself, since
// /auth/* deliberately stays reachable while maintenance is on (see
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md). Gating
// only on maintenance.active would block the login form itself, which
// defeats the whole point of exempting /auth/* on the backend.
import { computed, onMounted } from 'vue'
import { useAuthStore } from './store/auth'
import { useMaintenanceStore } from './store/maintenance'
import AppSidebar from './components/AppSidebar.vue'
import MaintenanceOverlay from './components/MaintenanceOverlay.vue'
import ImpersonationBanner from './components/ImpersonationBanner.vue'

const auth = useAuthStore()
const maintenance = useMaintenanceStore()
const hasSession = computed(() => auth.isStaff || auth.isManager)

onMounted(() => {
  maintenance.check()
})
</script>

<template>
  <div v-if="hasSession">
    <ImpersonationBanner v-if="auth.impersonating" />
    <div class="flex">
      <AppSidebar />
      <div class="flex-1 min-w-0 pb-[var(--mobile-nav-height,5rem)] md:pb-0">
        <router-view />
      </div>
    </div>
  </div>
  <router-view v-else />
  <MaintenanceOverlay v-if="maintenance.active && hasSession" />
</template>
