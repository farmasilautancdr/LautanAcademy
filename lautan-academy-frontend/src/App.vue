<script setup>
// Sidebar shows for every logged-in state (staff or any manager role) —
// login screens stay full-width, no sidebar before there's an identity to
// show in its footer.
import { computed } from 'vue'
import { useAuthStore } from './store/auth'
import AppSidebar from './components/AppSidebar.vue'

const auth = useAuthStore()
const showSidebar = computed(() => auth.isStaff || auth.isManager)
</script>

<template>
  <div v-if="showSidebar" class="flex">
    <AppSidebar />
    <div class="flex-1 min-w-0">
      <router-view />
    </div>
  </div>
  <router-view v-else />
</template>
