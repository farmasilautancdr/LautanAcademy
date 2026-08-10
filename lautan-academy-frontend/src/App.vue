<script setup>
// Sidebar shows for every logged-in state (staff or any manager role) —
// login screens stay full-width, no sidebar before there's an identity to
// show in its footer. MaintenanceOverlay is mounted unconditionally
// alongside both branches so it can cover the whole screen regardless of
// which one is active — see
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
import { computed, onMounted } from 'vue'
import { useAuthStore } from './store/auth'
import { useMaintenanceStore } from './store/maintenance'
import AppSidebar from './components/AppSidebar.vue'
import MaintenanceOverlay from './components/MaintenanceOverlay.vue'

const auth = useAuthStore()
const maintenance = useMaintenanceStore()
const showSidebar = computed(() => auth.isStaff || auth.isManager)

onMounted(() => {
  maintenance.check()
})
</script>

<template>
  <div v-if="showSidebar" class="flex">
    <AppSidebar />
    <div class="flex-1 min-w-0 pb-20 md:pb-0">
      <router-view />
    </div>
  </div>
  <router-view v-else />
  <MaintenanceOverlay v-if="maintenance.active" />
</template>
